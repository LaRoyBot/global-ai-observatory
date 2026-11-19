// Geographic reference data — deliberately independent of the flow renderer.
// Coordinates are real country reference points (capital / centroid), used as
// route endpoints. ISO_NUMERIC maps alpha-3 to the Natural Earth numeric id.
// SG_SUPPLEMENT is a real 1:50m outline for Singapore, which 1:110m omits.
/* ---------- 3. COUNTRY_COORDS — GEOGRAPHIC LOOKUP ----------
   Independent of all rendering logic. Real country reference points
   (approximate geographic centroids), ISO 3166-1 alpha-3 keys.
   To add a country: add it here, in ISO_NUMERIC, and use its code in
   FLOWS. Coordinates are route endpoints — never screen positions.
------------------------------------------------------------- */
export const COUNTRY_COORDS = {
  USA:{name:"United States",     lon:-98.58,  lat:39.83},
  CAN:{name:"Canada",            lon:-106.35, lat:56.13},
  BRA:{name:"Brazil",            lon:-51.93,  lat:-14.24},
  GBR:{name:"United Kingdom",    lon:-1.46,   lat:52.60},
  IRL:{name:"Ireland",           lon:-8.24,   lat:53.41},
  DEU:{name:"Germany",           lon:10.45,   lat:51.16},
  FRA:{name:"France",            lon:2.21,    lat:46.23},
  ARE:{name:"United Arab Emirates",lon:54.37, lat:23.42},
  IND:{name:"India",             lon:78.96,   lat:20.59},
  SGP:{name:"Singapore",         lon:103.82,  lat:1.35},
  JPN:{name:"Japan",             lon:138.25,  lat:36.20},
  KOR:{name:"South Korea",       lon:127.77,  lat:35.91},
  AUS:{name:"Australia",         lon:133.78,  lat:-25.27}
};

/* ISO alpha-3 -> ISO 3166-1 numeric, for matching Natural Earth atlas ids. */
export const ISO_NUMERIC = {
  USA:"840", CAN:"124", BRA:"076", GBR:"826", IRL:"372", DEU:"276",
  FRA:"250", ARE:"784", IND:"356", SGP:"702", JPN:"392", KOR:"410", AUS:"036"
};

/* Singapore supplement: Natural Earth 1:110m omits city-states, so the
   main-island outline below is embedded from Natural Earth 1:50m
   (world-atlas 2.0.2, country id 702), decimated to its 8 source vertices.
   Real geography, coarser resolution — not a fabricated shape. */
export const SG_SUPPLEMENT = {
  type:"Feature",
  properties:{name:"Singapore", iso:"SGP"},
  geometry:{type:"Polygon",coordinates:[[
    [103.9708,1.3321],[103.8196,1.2662],[103.6504,1.3252],[103.7044,1.4241],
    [103.8196,1.4467],[103.9096,1.4155],[103.96,1.3929],[103.996,1.3651],
    [103.9708,1.3321]
  ]]}
};
