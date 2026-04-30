Promise.all([
  d3.json('data/world.geojson'),
  d3.csv('data/per-capita-energy.csv'),
  d3.csv('data/energy-consumption-by-source-and-country.csv')
]).then(data => {
  const geoData      = data[0];
  const perCapitaCsv = data[1];
  const totalCsv     = data[2];

  // ── Energy type lists ──────────────────────────────────────────────────
  const energyTypesPC    = perCapitaCsv.columns.slice(3);   // kWh/capita columns
  const energyTypesTotal = totalCsv.columns.slice(3);       // TWh columns

  // filter to only common energy types so Total and Per Capita charts align
  const commonTypes = energyTypesPC.filter(t => energyTypesTotal.includes(t));
  const energyTypesPC_filtered = commonTypes;
  const energyTypesTotal_filtered = commonTypes; // use same order for both so colors match!

  // log what was removed for transparency
  const pcOnly = energyTypesPC.filter(t => !commonTypes.includes(t));
  const totalOnly = energyTypesTotal.filter(t => !commonTypes.includes(t));
  if (pcOnly.length > 0) console.log('Removed (PC only):', pcOnly);
  if (totalOnly.length > 0) console.log('Removed (Total only):', totalOnly);
  console.log('energyTypesPC_filtered:', energyTypesPC_filtered);
  console.log('energyTypesTotal_filtered:', energyTypesTotal_filtered);

  // create a unified energy type list and global color scale so colors match across charts
  const unifiedEnergyTypes = commonTypes;
  const createDistinctPalette = count => {
    const palette = [
      ...d3.schemeTableau10,
      ...d3.schemeSet3,
      ...d3.schemePaired
    ];
    return palette.slice(0, Math.max(0, count));
  };

  const globalColorScale = d3.scaleOrdinal()
    .domain(unifiedEnergyTypes)
    .range(createDistinctPalette(unifiedEnergyTypes.length));

  // ── Helpers ────────────────────────────────────────────────────────────
  const normalize = s => s ? String(s).toLowerCase().replace(/[^a-z0-9]/g, '') : '';

  // Build lookup for choropleth maps
  const energyLookup = { byName: {}, byCode: {}, byNorm: {}, rows: perCapitaCsv };
  perCapitaCsv.forEach(d => {
    d.Total = energyTypesPC_filtered.reduce((sum, t) => sum + (+d[t] || 0), 0);
    if (d.Entity) energyLookup.byName[d.Entity]  = d;
    if (d.Code)   energyLookup.byCode[d.Code]    = d;
    energyLookup.byNorm[normalize(d.Entity)]     = d;
  });

  // Build a separate lookup for total (TWh) CSV so the Total map uses total values
  const totalLookup = { byName: {}, byCode: {}, byNorm: {}, rows: totalCsv };
  totalCsv.forEach(d => {
    // compute Total from filtered total energy types
    d.Total = energyTypesTotal_filtered.reduce((sum, t) => sum + (+d[t] || 0), 0);
    if (d.Entity) totalLookup.byName[d.Entity]  = d;
    if (d.Code)   totalLookup.byCode[d.Code]    = d;
    totalLookup.byNorm[normalize(d.Entity)]     = d;
  });

  // ── VIS 1 — Stacked bar chart of total energy by country ───────────────
  // Filter out rows with no data
  const vis1Data = totalCsv.filter(d =>
    energyTypesTotal_filtered.some(k => +d[k] > 0)
  );

  const vis1Chart = new Barchart({
    parentElement:    '#vis1-container',
    containerWidth:   900,
    containerHeight:  vis1Data.length * 20 + 60,
    margin:           { top: 40, right: 170, bottom: 40, left: 160 },
    colorScale:       globalColorScale,
    isStacked:        true,
    energyTypes:      energyTypesTotal_filtered,
    unit:             'TWh'
  }, vis1Data);

  // ── VIS 2 — Single-type bar chart (total TWh) with dropdown ───────────
  const vis2Data = totalCsv.filter(d =>
    energyTypesTotal_filtered.some(k => +d[k] > 0)
  );

  const vis2Chart = new Barchart({
    parentElement:    '#vis2-container',
    containerWidth:   900,
    containerHeight:  vis2Data.length * 20 + 60,
    margin:           { top: 40, right: 30, bottom: 40, left: 160 },
    colorScale:       globalColorScale,
    isStacked:        false,
    energyTypes:      energyTypesTotal_filtered,
    unit:             'TWh'
  }, vis2Data);

  // Populate vis2 dropdown and wire it up
  const sel2 = d3.select('#energy-select3');
  sel2.selectAll('option')
    .data(energyTypesTotal_filtered)
    .join('option')
    .attr('value', d => d)
    .text(d => d);

  vis2Chart.updateVis(energyTypesTotal_filtered[0]);

  // defer initial selection until unified control is created
  sel2.on('change', function () {
    // keep dashboard selector in sync when user changes this dropdown
    const val = this.value;
    vis2Chart.updateVis(val);
    d3.select('#dashboard-energy-select').property('value', val);
  });

  // ── VIS 2.5 — Per-capita bar chart with dropdown ───────────────────────
  const vis25Data = perCapitaCsv.filter(d =>
    energyTypesPC_filtered.some(k => +d[k] > 0)
  );

  const vis25Chart = new Barchart({
    parentElement:    '#vis25-container',
    containerWidth:   900,
    containerHeight:  vis25Data.length * 20 + 60,
    margin:           { top: 40, right: 30, bottom: 40, left: 160 },
    colorScale:       globalColorScale,
    colorMap:         undefined, // will set below after normalize
    isStacked:        false,
    energyTypes:      energyTypesPC_filtered,
    unit:             'kWh/capita'
  }, vis25Data);

  const sel25 = d3.select('#energy-select25');
  sel25.selectAll('option')
    .data(energyTypesPC_filtered)
    .join('option')
    .attr('value', d => d)
    .text(d => d);

  vis25Chart.updateVis(energyTypesPC_filtered[0]);

  sel25.on('change', function () {
    const val = this.value;
    vis25Chart.updateVis(val);
    d3.select('#dashboard-energy-select').property('value', val);
  });

  // ── VIS 3 — Scatterplot: total vs per-capita ────────────────────────────
  new Scatterplot(
    { parentElement: '#vis3-container' },
    totalCsv,
    perCapitaCsv
  );

  // ── Choropleth maps (tabs 4 & 5) ──────────────────────────────────────
  const typesWithTotal = ['Total', ...energyTypesTotal_filtered];
  // unified types for maps so colors are consistent
  const unifiedTypesForMaps = typesWithTotal;

  const sel2map = d3.select('#energy-select2');
  sel2map.selectAll('option')
    .data(typesWithTotal)
    .join('option')
    .attr('value', d => d)
    .text(d => d);

  const totalMap = new ChoroplethMap({
    parentElement:    '#map2',
    containerWidth:   900,
    containerHeight:  600,
    energyTypes:      typesWithTotal,
    unifiedTypes:     unifiedTypesForMaps
  }, geoData, totalLookup);

  totalMap.setEnergyType('Total');
  sel2map.on('change', function () { 
    console.log('sel2map changed to:', this.value);
    totalMap.setEnergyType(this.value); 
  });

  const selMap = d3.select('#energy-select');
  selMap.selectAll('option')
    .data(energyTypesPC_filtered)
    .join('option')
    .attr('value', d => d)
    .text(d => d);

  const choroplethMap = new ChoroplethMap({
    parentElement:   '#map',
    containerWidth:  900,
    containerHeight: 600,
    energyTypes:     energyTypesPC_filtered,
    unifiedTypes:    unifiedTypesForMaps
  }, geoData, energyLookup);

  choroplethMap.setEnergyType(energyTypesPC_filtered[0]);
  selMap.on('change', function () { 
    console.log('selMap changed to:', this.value);
    choroplethMap.setEnergyType(this.value); 
  });

  // ── MINI VERSIONS FOR DASHBOARD ──────────────────────────────────────────
  const getMiniChartSize = selector => {
    const container = document.querySelector(selector);
    if (!container) {
      return { width: 280, height: 280 };
    }

    const rect = container.getBoundingClientRect();
    return {
      width: Math.max(240, Math.floor(rect.width)),
      height: Math.max(240, Math.floor(rect.height))
    };
  };

  // Vis 1 Mini - Stacked bar chart
  const vis1MiniSize = getMiniChartSize('#vis1-container-mini');
  const vis1MiniChart = new Barchart({
    parentElement:    '#vis1-container-mini',
    containerWidth:   vis1MiniSize.width,
    containerHeight:  vis1MiniSize.height,
    margin:           { top: 20, right: 20, bottom: 20, left: 80 },
    isStacked:        true,
    colorScale:       globalColorScale,
    colorMap:         undefined,
    energyTypes:      energyTypesTotal_filtered,
    unit:             'TWh',
    showLegend:       false
  }, vis1Data.slice(0, 10)); // Only top 10 countries

  // Vis 2 Mini - Single-type bar chart
  const vis2MiniSize = getMiniChartSize('#vis2-container-mini');
  const vis2MiniChart = new Barchart({
    parentElement:    '#vis2-container-mini',
    containerWidth:   vis2MiniSize.width,
    containerHeight:  vis2MiniSize.height,
    margin:           { top: 20, right: 20, bottom: 20, left: 80 },
    isStacked:        false,
    colorScale:       globalColorScale,
    colorMap:         undefined,
    energyTypes:      energyTypesTotal_filtered,
    unit:             'TWh'
  }, vis2Data.slice(0, 10)); // Only top 10 countries

  // Vis 2.5 Mini - Per-capita bar chart
  const vis25MiniSize = getMiniChartSize('#vis25-container-mini');
  const vis25MiniChart = new Barchart({
    parentElement:    '#vis25-container-mini',
    containerWidth:   vis25MiniSize.width,
    containerHeight:  vis25MiniSize.height,
    margin:           { top: 20, right: 20, bottom: 20, left: 80 },
    isStacked:        false,
    colorScale:       globalColorScale,
    colorMap:         undefined,
    energyTypes:      energyTypesPC_filtered,
    unit:             'kWh/capita'
  }, vis25Data.slice(0, 10)); // Only top 10 countries

  // Vis 3 Mini - Scatterplot
  const vis3MiniSize = getMiniChartSize('#vis3-container-mini');
  new Scatterplot(
    { parentElement: '#vis3-container-mini', containerWidth: vis3MiniSize.width, containerHeight: vis3MiniSize.height },
    totalCsv,
    perCapitaCsv
  );

  // Map 2 Mini - Total energy map
  const map2MiniSize = getMiniChartSize('#map2-mini');
  const totalMapMini = new ChoroplethMap({
    parentElement:    '#map2-mini',
    containerWidth:   map2MiniSize.width,
    containerHeight:  map2MiniSize.height,
    energyTypes:      typesWithTotal,
    unifiedTypes:     unifiedTypesForMaps
  }, geoData, totalLookup);

  totalMapMini.setEnergyType('Total');

  // Map Mini - Per capita energy map
  const mapMiniSize = getMiniChartSize('#map-mini');
  const choroplethMapMini = new ChoroplethMap({
    parentElement:    '#map-mini',
    containerWidth:   mapMiniSize.width,
    containerHeight:  mapMiniSize.height,
    energyTypes:      energyTypesPC_filtered,
    unifiedTypes:     unifiedTypesForMaps
  }, geoData, energyLookup);

  choroplethMapMini.setEnergyType(energyTypesPC[0]);

  // ── UNIFIED DASHBOARD CONTROL ──────────────────────────────────────────
  // populate selector with the unified list so both total and per-capita types are available
  const dashboardSelect = d3.select('#dashboard-energy-select');
  dashboardSelect.selectAll('option')
    .data(unifiedEnergyTypes)
    .join('option')
    .attr('value', d => d)
    .text(d => d);

  // Build the color legend next to the selector
  // Use the actual bar colors to match what's displayed
  const actualBarColors = {
    'Coal': 'rgb(210, 62, 167)',
    'Oil': 'rgb(255, 94, 99)',
    'Gas': 'rgb(239, 167, 47)',
    'Nuclear': 'rgb(175, 240, 91)',
    'Hydropower': 'rgb(64, 243, 115)',
    'Wind': 'rgb(26, 199, 194)',
    'Solar': 'rgb(65, 125, 224)',
    'Other renewables': 'rgb(110, 64, 170)'
  };
  
  const legendContainer = d3.select('#dashboard-legend');
  legendContainer.selectAll('.color-legend-item')
    .data(unifiedEnergyTypes)
    .join('div')
      .attr('class', 'color-legend-item')
      .html(d => `
        <span class="color-legend-swatch" style="background-color: ${actualBarColors[d] || '#999'}"></span>
        <span>${d}</span>
      `);

  // Initialize with a sensible default (first common per-capita type if available)
  const initialType = energyTypesPC_filtered[0] || unifiedEnergyTypes[0];
  dashboardSelect.property('value', initialType);
  // update mini charts
  vis2MiniChart.updateVis(initialType);
  vis25MiniChart.updateVis(initialType);
  choroplethMapMini.setEnergyType(initialType);

  // also initialize total maps if the initial type exists in total types
  if (energyTypesTotal_filtered.includes(initialType)) {
    totalMapMini.setEnergyType(initialType);
    totalMap.setEnergyType(initialType);
  }

  // update full-size charts and their dropdowns when possible
  if (energyTypesTotal.includes(initialType)) {
    vis2Chart.updateVis(initialType);
    d3.select('#energy-select3').property('value', initialType);
  }
  if (energyTypesPC.includes(initialType)) {
    vis25Chart.updateVis(initialType);
    d3.select('#energy-select25').property('value', initialType);
  }

  // Wire up all mini charts to respond to the dashboard selection
  dashboardSelect.on('change', function () {
    const selectedEnergy = this.value;
    vis2MiniChart.updateVis(selectedEnergy);
    vis25MiniChart.updateVis(selectedEnergy);
    choroplethMapMini.setEnergyType(selectedEnergy);
    if (energyTypesTotal_filtered.includes(selectedEnergy)) {
      // update total bar charts and both total maps (mini + full)
      vis2Chart.updateVis(selectedEnergy);
      d3.select('#energy-select3').property('value', selectedEnergy);
      if (typeof totalMapMini !== 'undefined') totalMapMini.setEnergyType(selectedEnergy);
      if (typeof totalMap !== 'undefined') totalMap.setEnergyType(selectedEnergy);
    }
    if (energyTypesPC_filtered.includes(selectedEnergy)) {
      vis25Chart.updateVis(selectedEnergy);
      d3.select('#energy-select25').property('value', selectedEnergy);
    }
  });

  // Debugging info: print the type lists and color mappings to console
  console.log('energyTypesTotal:', energyTypesTotal);
  console.log('energyTypesPC:', energyTypesPC);
  console.log('energyTypesTotal_filtered:', energyTypesTotal_filtered);
  console.log('energyTypesPC_filtered:', energyTypesPC_filtered);
  console.log('unifiedEnergyTypes:', unifiedEnergyTypes);
  console.log('globalColorScale domain:', globalColorScale.domain());
  unifiedEnergyTypes.forEach(t => console.log('color for', t, ':', globalColorScale(t)));

  // build a normalized color map so both charts can lookup by normalized type
  // prefer unifiedTypesForMaps (which includes 'Total') when available so map/bar colors match
  const mapTypes = (typeof unifiedTypesForMaps !== 'undefined' && unifiedTypesForMaps.length > 0)
    ? unifiedTypesForMaps
    : unifiedEnergyTypes;
  const globalColorMap = {};
  if (mapTypes && mapTypes.length > 0) {
    const n = mapTypes.length;
    mapTypes.forEach((t, i) => {
      const frac = n > 1 ? (i / (n - 1)) : 0;
      // use the choropleth's base color function (interpolateRainbow) for per-type color
      const col = d3.interpolateRainbow(frac);
      globalColorMap[normalize(t)] = col;
    });
  } else {
    unifiedEnergyTypes.forEach(t => { globalColorMap[normalize(t)] = globalColorScale(t); });
  }

  // inject colorMap into existing charts that were created earlier
  try {
    // full-size charts
    if (typeof vis1Chart !== 'undefined') {
      vis1Chart.config.colorMap = globalColorMap;
      vis1Chart.colorMap = globalColorMap;
      vis1Chart.updateVis(vis1Chart.selectedType || energyTypesTotal_filtered[0]);
    }
    if (typeof vis1MiniChart !== 'undefined') {
      vis1MiniChart.config.colorMap = globalColorMap;
      vis1MiniChart.colorMap = globalColorMap;
      vis1MiniChart.updateVis(vis1MiniChart.selectedType || energyTypesTotal_filtered[0]);
    }
    if (typeof vis2Chart !== 'undefined') {
      vis2Chart.config.colorMap = globalColorMap;
      vis2Chart.colorMap = globalColorMap;
      vis2Chart.updateVis(vis2Chart.selectedType || unifiedEnergyTypes[0]);
    }
    if (typeof vis25Chart !== 'undefined') {
      vis25Chart.config.colorMap = globalColorMap;
      vis25Chart.colorMap = globalColorMap;
      vis25Chart.updateVis(vis25Chart.selectedType || unifiedEnergyTypes[0]);
    }
    // mini charts - if variables exist, attach map and re-render
    if (typeof vis2MiniChart !== 'undefined') {
      vis2MiniChart.config.colorMap = globalColorMap;
      vis2MiniChart.colorMap = globalColorMap;
      vis2MiniChart.updateVis(vis2MiniChart.selectedType || unifiedEnergyTypes[0]);
    }
    if (typeof vis25MiniChart !== 'undefined') {
      vis25MiniChart.config.colorMap = globalColorMap;
      vis25MiniChart.colorMap = globalColorMap;
      vis25MiniChart.updateVis(vis25MiniChart.selectedType || unifiedEnergyTypes[0]);
    }
  } catch (e) { console.warn('Could not inject colorMap into chart instances', e); }

}).catch(error => console.error(error));
