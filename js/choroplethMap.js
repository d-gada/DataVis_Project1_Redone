class ChoroplethMap {

  static nextId = 0;

  /**
   * Class constructor with basic configuration
   * @param {Object} _config configuration object
   * @param {Object} _geoData geojson data for world
   * @param {Object} _energyData map from country name to row values
   */
  constructor(_config, _geoData, _energyData) {
    this.config = {
      parentElement: _config.parentElement,
      containerWidth: _config.containerWidth || 500,
      containerHeight: _config.containerHeight || 400,
      margin: _config.margin || { top: 0, right: 0, bottom: 0, left: 0 },
      chartYOffset: _config.chartYOffset || -12,
      tooltipPadding: 10,
      legendBottom: 20,
      legendLeft: 50,
      legendRectHeight: 12,
      legendRectWidth: 150
    }
    this.geoData = _geoData;
    this.energyData = _energyData;
    // list of all possible energy types for palette selection
    this.config.energyTypes = _config.energyTypes || [];
    // optional unified types list for consistent color assignment across maps
    this.config.unifiedTypes = _config.unifiedTypes || this.config.energyTypes;
    this.instanceId = ChoroplethMap.nextId += 1;
    this.selectedType = null;
    this.selectedCountries = new Set(); // Track current selection
    this.initVis();
    // Register this chart with the global SelectionManager
    if (window.SelectionManager) {
      window.SelectionManager.registerChart(this);
    }
  }

  /**
   * We initialize scales/axes and append static elements, such as axis titles.
   */
  initVis() {
    let vis = this;

    // Calculate inner chart size. Margin specifies the space around the actual chart.
    vis.width = vis.config.containerWidth - vis.config.margin.left - vis.config.margin.right;
    vis.height = vis.config.containerHeight - vis.config.margin.top - vis.config.margin.bottom;

    // Define size of SVG drawing area
    vis.svg = d3.select(vis.config.parentElement).append('svg')
      .attr('width', vis.config.containerWidth)
      .attr('height', vis.config.containerHeight);

    // Append group element that will contain our actual chart 
    // and position it according to the given margin config
    vis.chart = vis.svg.append('g')
      .attr('transform', `translate(${vis.config.margin.left},${vis.config.margin.top + vis.config.chartYOffset})`);

    // Initialize projection and path generator
    vis.projection = d3.geoMercator();
    vis.geoPath = d3.geoPath().projection(vis.projection);

    vis.colorScale = d3.scaleLinear()
      .range(['#cfe2f2', '#0d306b'])
      .interpolate(d3.interpolateHcl);

    // energy value that will be used for coloring (added in updateVis)
    vis.currentValues = [];

    // Antarctica is omitted from the rendered map to keep the view focused on countries.
    vis.renderedGeoData = {
      ...vis.geoData,
      features: vis.geoData.features.filter(feature => feature?.properties?.name !== 'Antarctica')
    };


    // Initialize gradient that we will later use for the legend
    vis.linearGradient = vis.svg.append('defs').append('linearGradient')
      .attr('id', `legend-gradient-${vis.instanceId}`);

    // Append legend
    vis.legend = vis.chart.append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${vis.config.legendLeft},${vis.height - vis.config.legendBottom})`);

    vis.legendRect = vis.legend.append('rect')
      .attr('width', vis.config.legendRectWidth)
      .attr('height', vis.config.legendRectHeight);

    vis.legendTitle = vis.legend.append('text')
      .attr('class', 'legend-title')
      .attr('dy', '.35em')
      .attr('y', -10)
      .text('')

    vis.updateVis();
  }

  // updateVis is called any time the selectedType or data changes
  updateVis() {
    let vis = this;

    // compute energy value for each feature and store on properties
    vis.currentValues = vis.renderedGeoData.features.map(f => {
      // robust lookup: try exact name, ISO codes, id, and normalized name
      const getProp = p => (f.properties && f.properties[p]) || f[p] || null;
      const name = getProp('name') || getProp('ADMIN') || getProp('NAME') || '';
      const isoA3 = getProp('iso_a3') || getProp('ISO_A3') || getProp('iso3');
      const isoA2 = getProp('iso_a2') || getProp('ISO_A2') || getProp('iso2');

      const normalize = s => s ? String(s).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
      const normName = normalize(name);

      let row = null;
      if (vis.energyData) {
        // if energyData is a lookup object with multiple maps
        if (vis.energyData.byName || vis.energyData.byCode || vis.energyData.byNorm) {
          // try common keys: exact Entity name, ISO codes, feature id, normalized name
          row = (vis.energyData.byName && vis.energyData.byName[name])
            || (isoA3 && vis.energyData.byCode && vis.energyData.byCode[isoA3])
            || (isoA2 && vis.energyData.byCode && vis.energyData.byCode[isoA2])
            || (f.id && vis.energyData.byCode && vis.energyData.byCode[f.id])
            || (vis.energyData.byName && vis.energyData.byName[f.id])
            || (vis.energyData.byNorm && vis.energyData.byNorm[normName])
            || null;
        } else {
          // fallback: energyData might be a simple map keyed by name or code
          row = vis.energyData[name] || vis.energyData[f.id] || vis.energyData[normName] || vis.energyData[String(name).toUpperCase()] || null;
        }
      }

      // If still not found, try fuzzy matching against available CSV rows (includes checks)
      if (!row && vis.energyData && vis.energyData.rows && Array.isArray(vis.energyData.rows)) {
        const rows = vis.energyData.rows;
        for (let i = 0; i < rows.length; i++) {
          const r = rows[i];
          const rnorm = normalize(r.Entity || r.EntityName || '');
          if (!rnorm) continue;
          if (rnorm === normName || rnorm.includes(normName) || normName.includes(rnorm)) {
            row = r;
            break;
          }
        }
      }

      // attach lookup diagnostics to the feature for debugging
      if (!row) {
        f.properties._lookupAttempt = { name, isoA3, isoA2, normName };
      }

      let val = null;
      if (row != null) {
        // robust retrieval: try exact key, then normalized-key match across row properties
        const findRowValue = (r, k) => {
          if (r == null) return undefined;
          if (r[k] !== undefined) return r[k];
          const kn = k ? String(k).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
          for (const rk of Object.keys(r)) {
            if (String(rk).toLowerCase().replace(/[^a-z0-9]/g, '') === kn) return r[rk];
          }
          return undefined;
        };

        const lookupVal = (typeof row === 'number') ? row : (vis.selectedType ? findRowValue(row, vis.selectedType) : undefined);
        console.log('ChoroplethMap.lookup', { name, normName, selectedType: vis.selectedType, hasRow: !!row, lookupVal });
        if (typeof row === 'number') {
          val = row;
        } else if (vis.selectedType) {
          val = +lookupVal;
        }
      }
      f.properties.energy = val;
      return val;
    }).filter(v => v != null);

    const valueExtent = d3.extent(vis.currentValues);

    // if no valid values yet, skip domain update and legend
    if (valueExtent[0] == null) {
      vis.legendStops = [];
    } else {
      // Update color scale
      vis.colorScale.domain(valueExtent);

      const [startColor, endColor] = vis.colorScale.range();
      const legendStart = startColor || '#cfe2f2';
      const legendEnd = endColor || '#0d306b';

      // Define begin and end of the color gradient (legend)
      vis.legendStops = [
        { color: legendStart, value: valueExtent[0], offset: 0 },
        { color: legendEnd, value: valueExtent[1], offset: 100 },
      ];
    }

    // update legend title
    vis.legendTitle.text(vis.selectedType || '');

    // finally re‑render the map with the new scale/data
    vis.renderVis();
  }

  // set the current energy type and refresh the map
  setEnergyType(type) {
    this.selectedType = type;
    console.log('ChoroplethMap.setEnergyType called:', type, 'unifiedTypes:', this.config.unifiedTypes);

    // change color scheme based on type index in the unified list for consistency
    if (this.config.unifiedTypes.length > 0) {
      const idx = this.config.unifiedTypes.indexOf(type);
      console.log('Type index in unifiedTypes:', idx);
      const n = this.config.unifiedTypes.length;
      const t = idx >= 0 ? idx / Math.max(1, n - 1) : 0;
      const startColor = d3.interpolateRainbow(t);
      const endColor = d3.interpolateRainbow((t + 0.2) % 1);
      this.colorScale.range([startColor, endColor]);
    }

    this.updateVis();
  }


  renderVis() {
    let vis = this;

    // GeoJSON data is already provided in geoData
    const countries = vis.renderedGeoData;

    // Defines the scale of the projection so that the geometry fits within the SVG area
    vis.projection.fitSize([vis.width, vis.height], countries);

    // Append or update world map
    const countryPath = vis.chart.selectAll('.country')
      .data(countries.features)
      .join('path')
      .attr('class', 'country')
      .attr('d', vis.geoPath)
      .attr('fill', d => {
        const val = d.properties.energy;
        if (val != null) {
          return vis.colorScale(val);
        } else {
          return 'url(#lightstripe)';
        }
      })
      .style('stroke', d => {
        return vis.selectedCountries.has(d.properties.name) ? '#ffffff' : 'none';
      })
      .style('stroke-width', d => {
        return vis.selectedCountries.has(d.properties.name) ? 1 : 0;
      })
      .style('opacity', d => {
        return vis.selectedCountries.has(d.properties.name) ? 1 : 0.7;
      });

    countryPath
      .on('click', (event, d) => {
        event.stopPropagation();
        const countryName = d.properties.name;
        if (vis.selectedCountries.has(countryName)) {
          vis.selectedCountries.delete(countryName);
        } else {
          vis.selectedCountries.add(countryName);
        }
        // Notify SelectionManager
        if (window.SelectionManager) {
          window.SelectionManager.setSelection(vis.selectedCountries);
        }
        vis._updateMapSelection();
      })
      .on('mousemove', (event, d) => {
        const val = d.properties.energy;
        const info = val != null
          ? `<strong>${Math.round(val * 10) / 10}</strong> ${vis.selectedType}`
          : 'No data available';
        d3.select('#tooltip')
          .style('display', 'block')
          .style('left', (event.pageX + vis.config.tooltipPadding) + 'px')
          .style('top', (event.pageY + vis.config.tooltipPadding) + 'px')
          .html(`
              <div class="tooltip-title">${d.properties.name}</div>
              <div>${info}</div>
            `);
      })
      .on('mouseleave', () => {
        d3.select('#tooltip').style('display', 'none');
      });

    // Add legend labels
    vis.legend.selectAll('.legend-label')
      .data(vis.legendStops)
      .join('text')
      .attr('class', 'legend-label')
      .attr('text-anchor', 'middle')
      .attr('dy', '.35em')
      .attr('y', 20)
      .attr('x', (d, index) => {
        return index == 0 ? 0 : vis.config.legendRectWidth;
      })
      .text(d => Math.round(d.value * 10) / 10);

    // Update gradient for legend
    vis.linearGradient.selectAll('stop')
      .data(vis.legendStops)
      .join('stop')
      .attr('offset', d => d.offset)
      .attr('stop-color', d => d.color);

    vis.legendRect.attr('fill', `url(#legend-gradient-${vis.instanceId})`);
  }

  _updateMapSelection() {
    let vis = this;
    // Re-render the map with selection highlighting
    vis.chart.selectAll('path.country')
      .style('stroke', d => {
        return vis.selectedCountries.has(d.properties.name) ? '#ffffff' : 'none';
      })
      .style('stroke-width', d => {
        return vis.selectedCountries.has(d.properties.name) ? 1 : 0;
      })
      .style('opacity', d => {
        return vis.selectedCountries.has(d.properties.name) ? 1 : 0.7;
      });
  }

  applySelection(selectedCountries) {
    let vis = this;
    vis.selectedCountries = selectedCountries;
    vis._updateMapSelection();
  }
}
