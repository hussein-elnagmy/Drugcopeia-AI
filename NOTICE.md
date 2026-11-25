# Bundled data attributions

The app code in this repository is licensed under the GNU Affero General Public
License v3 (see LICENSE). The upstream texts bundled under `Source/webapp/assets/`
remain the work of their sources and are not claimed under the project's license:

- **Health conditions** (`conditions.json`) — Source: MedlinePlus, National Library
  of Medicine. Public domain (U.S. federal government work); retrieved 2026-11-24
  through the MedlinePlus bulk XML web service.
- **Lab test guides** (`lab-tests-content.json`) — Source: MedlinePlus, National
  Library of Medicine. Public domain per
  https://medlineplus.gov/about/using/usingcontent/ ("Medical test information");
  retrieved 2026-11-25.
- **Drug monographs** (`monographs.json`) — excerpted from U.S. FDA Structured
  Product Labels via the openFDA drug label API (https://open.fda.gov/apis/drug/label/);
  full labels are linked per section on DailyMed (U.S. National Library of Medicine).
  These are U.S. reference labels for the named ingredient, shown with the source
  label's date; they are not the Egyptian product's own labeling unless the app
  states a verified match, and the local leaflet stays the reference.
- **Egyptian medicine directory** (`egyptian-drugs.json`) — see the source link in
  the app footer.
