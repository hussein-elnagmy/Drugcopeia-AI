#!/usr/bin/env python3
"""Turn privacy.config.json into the two artifacts that enforce it.

  webapp/generated/privacy-config.js          window.DAWAYA_PRIVACY_CONFIG (read by net.js)
  android/.../res/xml/network_security_config.xml   platform-level allowlist

Run from sync-web.sh and from every platform build. Output is deterministic:
the same config always produces byte-identical files, so a build can assert
that what shipped matches what was reviewed.
"""

import json
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG_PATH = os.path.join(ROOT, "privacy.config.json")
JS_OUT = os.path.join(ROOT, "webapp", "generated", "privacy-config.js")
XML_OUT = os.path.join(
    ROOT, "android", "app", "src", "main", "res", "xml", "network_security_config.xml"
)

BANNER = "GENERATED FILE - do not edit. Source: Source/privacy.config.json. Run scripts/gen-privacy-config.py."


def fail(message):
    raise SystemExit("gen-privacy-config: " + message)


def load_config():
    try:
        with open(CONFIG_PATH, encoding="utf-8") as handle:
            config = json.load(handle)
    except FileNotFoundError:
        fail("privacy.config.json not found at %s" % CONFIG_PATH)
    except ValueError as error:
        fail("privacy.config.json is not valid JSON: %s" % error)

    network = config.get("network")
    if not isinstance(network, dict):
        fail("privacy.config.json has no network section")
    hosts = network.get("allowedHosts")
    if not isinstance(hosts, list) or not hosts:
        fail("network.allowedHosts must be a non-empty list")
    for entry in hosts:
        if not isinstance(entry, dict) or not entry.get("host"):
            fail("every allowedHosts entry needs a host")
        if entry.get("localhost") is not True and entry.get("scheme") not in ("http", "https"):
            fail("host %s needs scheme http or https" % entry.get("host"))
        if "pathPrefix" in entry and "pathPrefixes" not in entry:
            entry["pathPrefixes"] = [entry.pop("pathPrefix")]
        if "pathPrefixes" in entry and not isinstance(entry["pathPrefixes"], list):
            fail("host %s pathPrefixes must be a list" % entry.get("host"))
    history = config.get("history")
    if not isinstance(history, dict) or history.get("defaultEnabled") is not True:
        fail("privacy.config.json history.defaultEnabled must be true")
    if history.get("encryptAtRest") is not True:
        fail("privacy.config.json history.encryptAtRest must be true")
    if history.get("deleteOneAtATime") is not True:
        fail("privacy.config.json history.deleteOneAtATime must be true")
    return config


def history_payload(config):
    """Limits for saved conversations. ai/secure-history.js reads these and
    falls back to the same numbers when the generated file is missing."""
    history = config.get("history") or {}
    return {
        "defaultEnabled": history.get("defaultEnabled") is not False,
        "encryptAtRest": history.get("encryptAtRest") is not False,
        "maxTurns": int(history.get("maxTurnsPerSession") or 50),
        "maxSessions": int(history.get("maxSessions") or 30),
        "maxAnswerChars": int(history.get("maxAnswerChars") or 4000),
        "maxBytes": int(history.get("maxBytes") or 400000),
    }


def network_payload(config):
    """The subset of the config the browser needs. Purposes stay in for the
    Privacy screen, so the UI can describe exactly why each host exists."""
    network = config["network"]
    return {
        "history": history_payload(config),
        "version": config.get("version", 1),
        "defaultOffline": bool(network.get("defaultOffline", True)),
        "offlineKey": network.get("offlineKey", "dawaya-offline-mode"),
        "allowedHosts": [
            {
                "host": entry["host"],
                "scheme": entry.get("scheme", "https"),
                "pathPrefixes": list(entry.get("pathPrefixes") or []),
                "purpose": entry.get("purpose", ""),
                "userInitiatedOnly": entry.get("userInitiatedOnly") is True,
                "localhost": entry.get("localhost") is True,
                "methods": list(entry.get("methods") or ["GET"]),
                "maxBytes": entry.get("maxBytes", 0),
            }
            for entry in network["allowedHosts"]
        ],
        "forbiddenRequestHeaders": list(network.get("forbiddenRequestHeaders") or []),
        "forbiddenUrlParameters": list(network.get("forbiddenUrlParameters") or []),
        "bannedThirdPartyOrigins": list(network.get("bannedThirdPartyOrigins") or []),
        "storage": {
            "localUserDataKeys": list((config.get("storage") or {}).get("localUserDataKeys") or []),
            "plaintextAllowedKeys": list((config.get("storage") or {}).get("plaintextAllowedKeys") or []),
        },
    }


def model_payload(config):
    """Model download hosts are shown in the Privacy screen and gate
    DawayaNet.modelDownload, the web runtime's one door to them. They are not
    in network.allowedHosts, so nothing else may reach them from the page."""
    model = config.get("modelDownload") or {}
    return {
        "requiresOfflineModeOff": model.get("requiresOfflineModeOff") is not False,
        "userInitiatedOnly": model.get("userInitiatedOnly") is not False,
        "hosts": [
            {
                "host": entry.get("host", ""),
                "suffix": entry.get("suffix", ""),
                "scheme": entry.get("scheme", "https"),
                "purpose": entry.get("purpose", ""),
            }
            for entry in (model.get("hosts") or [])
        ],
        "maxRedirects": int(model.get("maxRedirects") or 0),
    }


def write_js(config):
    payload = json.dumps(network_payload(config), indent=2, ensure_ascii=False)
    model_payload_json = json.dumps(model_payload(config), indent=2, ensure_ascii=False)
    body = (
        "/* %s */\n"
        "(function (root) {\n"
        "  'use strict';\n"
        "  root.DAWAYA_PRIVACY_CONFIG = Object.freeze(%s);\n"
        "  root.DAWAYA_MODEL_DOWNLOAD = Object.freeze(%s);\n"
        "})(typeof globalThis !== 'undefined' ? globalThis : this);\n" % (BANNER, payload, model_payload_json)
    )
    os.makedirs(os.path.dirname(JS_OUT), exist_ok=True)
    with open(JS_OUT, "w", encoding="utf-8") as handle:
        handle.write(body)
    return JS_OUT


def xml_comment(text, indent="    "):
    lines = [line.strip() for line in text.strip().splitlines() if line.strip()]
    inner = "\n".join(indent + "    " + line for line in lines)
    return indent + "<!--\n" + inner + "\n" + indent + "-->"


def write_android_xml(config):
    network = config["network"]
    remote = [h for h in network["allowedHosts"] if h.get("localhost") is not True]
    loopback = [h for h in network["allowedHosts"] if h.get("localhost") is True]

    parts = []
    parts.append('<?xml version="1.0" encoding="utf-8"?>')
    parts.append(xml_comment(
        "%s\n"
        "Cleartext is disabled everywhere. The domain entries below mirror\n"
        "network.allowedHosts exactly: a host that is not listed cannot be reached\n"
        "by this process at all. DawayaPrivacyWebViewClient enforces the same list\n"
        "per request; this file is the second, socket-level layer." % BANNER
    ))
    parts.append('<network-security-config>')
    parts.append('    <base-config cleartextTrafficPermitted="false">')
    parts.append('        <trust-anchors>')
    parts.append('            <certificates src="system" />')
    parts.append('        </trust-anchors>')
    parts.append('    </base-config>')

    for entry in remote:
        scheme = entry.get("scheme", "https")
        cleartext = "true" if scheme == "http" else "false"
        parts.append('    <domain-config cleartextTrafficPermitted="%s">' % cleartext)
        parts.append('        <domain includeSubdomains="false">%s</domain>' % entry["host"])
        parts.append('    </domain-config>')

    if loopback:
        # Android serves the bundled app from the https://localhost asset origin
        # inside the WebView, so loopback stays cleartext-denied here on purpose:
        # a cleartext exception would let any other app's listener on the device
        # receive traffic.
        parts.append(xml_comment(
            "Loopback entries exist for the desktop shells only. Android stays\n"
            "cleartext-denied for localhost and 127.0.0.1."
        ))
        parts.append('    <domain-config cleartextTrafficPermitted="false">')
        for entry in loopback:
            parts.append('        <domain includeSubdomains="false">%s</domain>' % entry["host"])
        parts.append('    </domain-config>')

    parts.append('    <debug-overrides>')
    parts.append('        <trust-anchors>')
    parts.append('            <certificates src="system" />')
    parts.append('        </trust-anchors>')
    parts.append('    </debug-overrides>')
    parts.append('</network-security-config>')
    with open(XML_OUT, "w", encoding="utf-8") as handle:
        handle.write("\n".join(parts) + "\n")
    return XML_OUT


def main():
    config = load_config()
    js_path = write_js(config)
    xml_path = write_android_xml(config)
    hosts = ", ".join(entry["host"] for entry in config["network"]["allowedHosts"])
    print("privacy config -> %s" % os.path.relpath(js_path, ROOT))
    print("privacy config -> %s" % os.path.relpath(xml_path, ROOT))
    print("allowlisted hosts: %s" % hosts)
    return 0


if __name__ == "__main__":
    sys.exit(main())
