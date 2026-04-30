# D3 Choropleth Map

This branch of the example has been adapted to show a **world map** instead of an Africa-only map.

### Features

- Uses a global GeoJSON file loaded from a CDN
- Loads energy consumption data per capita from data/per-capita-energy.csv (columns include various energy types such as Coal, Oil, Gas, Nuclear, Hydropower, Wind, Solar, Other renewables)
- Dropdown selector allows the user to choose an energy type to visualize
- Legend and tooltips update based on the selected type
- Countries with no data are rendered with a striped pattern

The older frica.json and egion_population_density.csv files are no longer used and can be ignored.


## Appearance

This example now uses a dark theme with a darker map background. Each energy type gets its own color gradient (selected from the rainbow palette), and the map size has been increased for better readability.


## Dashboard Layout

The page now features a simple 5tab dashboard. The energy choropleth occupies the **fifth tab**, with placeholders for other sections. Tabs are implemented with minimal CSS/JS.


### Tab1: Stacked bar chart

The first tab now renders a stacked bar chart breaking each countrys total energy use into the various types. The same CSV dataset drives both the bar chart and the map.


### Tab4: Total energy choropleth

The fourth tab now displays another choropleth map showing each countrys **total** energy use per capita. It uses the same setup as the energytype map but is not selectable. The legend title is set accordingly.
