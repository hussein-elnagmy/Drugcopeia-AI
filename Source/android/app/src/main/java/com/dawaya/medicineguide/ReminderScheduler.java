package com.dawaya.medicineguide;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.Calendar;

/**
 * Stores the reminders synced from the web layer and keeps one daily alarm per
 * reminder, plus follow-up alarms until the dose is confirmed taken. The alarms
 * survive reboots through {@link ReminderBootReceiver}.
 */
final class ReminderScheduler {
    static final String PREFS = "dawaya_reminders";
    static final String KEY_ITEMS = "items";
    static final String ACTION_REMINDER = "com.dawaya.medicineguide.action.REMINDER";

    // Mirrors `DawayaCore.reminders.ESCALATION_MINUTES` in the web layer.
    static final int[] ESCALATION_OFFSETS = { 0, 10, 30 };

    private ReminderScheduler() {}

    static JSONArray load(Context context) {
        String raw = prefs(context).getString(KEY_ITEMS, "[]");
        try {
            return new JSONArray(raw == null ? "[]" : raw);
        } catch (JSONException error) {
            return new JSONArray();
        }
    }

    static void sync(Context context, JSONArray items) {
        cancelAll(context);
        prefs(context).edit().putString(KEY_ITEMS, items.toString()).apply();
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        for (int index = 0; index < items.length(); index++) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            scheduleAll(context, manager, item);
        }
    }

    static void restore(Context context) {
        JSONArray items = load(context);
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        for (int index = 0; index < items.length(); index++) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            scheduleAll(context, manager, item);
        }
    }

    /** Schedules the base alarm and every follow-up that is still pending. */
    static void scheduleAll(Context context, AlarmManager manager, JSONObject item) {
        for (int offset : offsets(item)) {
            schedule(context, manager, item, offset, nextTrigger(item.optString("time", ""), offset));
        }
    }

    /** A dose confirmed for today keeps its daily alert but drops the follow-ups. */
    static int[] offsets(JSONObject item) {
        return item.optBoolean("taken", false)
            ? new int[] { 0 }
            : ESCALATION_OFFSETS.clone();
    }

    static void schedule(Context context, AlarmManager manager, JSONObject item, int offset, long triggerAt) {
        if (triggerAt <= 0) return;
        PendingIntent operation = pendingIntent(context, item, offset);
        if (operation == null) return;
        try {
            if (Build.VERSION.SDK_INT >= 31 && !manager.canScheduleExactAlarms()) {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation);
            } else if (Build.VERSION.SDK_INT >= 23) {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation);
            } else {
                manager.setExact(AlarmManager.RTC_WAKEUP, triggerAt, operation);
            }
        } catch (SecurityException error) {
            manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, triggerAt, operation);
        }
    }

    static long nextTrigger(String time, int offset) {
        int[] parts = parse(time);
        if (parts == null) return 0;
        int total = parts[0] * 60 + parts[1] + offset;
        Calendar now = Calendar.getInstance();
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, (total / 60) % 24);
        next.set(Calendar.MINUTE, total % 60);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (!next.after(now)) next.add(Calendar.DAY_OF_YEAR, 1);
        return next.getTimeInMillis();
    }

    static int[] parse(String time) {
        if (time == null) return null;
        String value = time.trim();
        if (value.length() != 5 || value.charAt(2) != ':') return null;
        try {
            int hour = Integer.parseInt(value.substring(0, 2));
            int minute = Integer.parseInt(value.substring(3, 5));
            if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
            return new int[] { hour, minute };
        } catch (NumberFormatException error) {
            return null;
        }
    }

    static int requestCode(String id, String time, int offset) {
        return (id + "@" + time + "+" + offset).hashCode() & 0x7fffffff;
    }

    private static PendingIntent pendingIntent(Context context, JSONObject item, int offset) {
        String id = item.optString("id", "");
        String time = item.optString("time", "");
        if (parse(time) == null) return null;
        Intent intent = new Intent(context, ReminderReceiver.class);
        intent.setAction(ACTION_REMINDER);
        intent.putExtra("id", id);
        intent.putExtra("name", item.optString("name", ""));
        intent.putExtra("dose", item.optString("dose", ""));
        intent.putExtra("time", time);
        intent.putExtra("offset", offset);
        int flags = PendingIntent.FLAG_UPDATE_CURRENT;
        if (Build.VERSION.SDK_INT >= 23) flags |= PendingIntent.FLAG_IMMUTABLE;
        return PendingIntent.getBroadcast(context, requestCode(id, time, offset), intent, flags);
    }

    private static void cancelAll(Context context) {
        JSONArray items = load(context);
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        for (int index = 0; index < items.length(); index++) {
            JSONObject item = items.optJSONObject(index);
            if (item == null) continue;
            for (int offset : ESCALATION_OFFSETS) {
                PendingIntent operation = pendingIntent(context, item, offset);
                if (operation != null) manager.cancel(operation);
            }
        }
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
