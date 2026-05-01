class Barchart {
  constructor(_config, _data) {
    this.config = {
      parentElement: _config.parentElement,
      containerWidth: _config.containerWidth || 900,
      containerHeight: _config.containerHeight || 2000,
      margin: _config.margin || { top: 40, right: 30, bottom: 40, left: 160 },
      isStacked: _config.isStacked || false,
      energyTypes: _config.energyTypes || [],
      unit: _config.unit || 'TWh',
      showLegend: _config.showLegend !== false  // Default to true
    };
    this.data = _data;
    this.selectedCountries = new Set(); // Track current selection
    this.initVis();
    // Register this chart with the global SelectionManager
    if (window.SelectionManager) {
      window.SelectionManager.registerChart(this);
    }
  }

  initVis() {
    let vis = this;
    vis.width  = vis.config.containerWidth  - vis.config.margin.left - vis.config.margin.right;
    vis.height = vis.config.containerHeight - vis.config.margin.top  - vis.config.margin.bottom;

    const wrapper = d3.select(vis.config.parentElement)
      .append('div')
      .attr('class', 'chart-shell')
      .style('width', '100%')
      .style('height', '100%')
      .style('overflow', 'auto')
      .style('display', 'flex')
      .style('flex-direction', 'column');

    // expose wrapper DOM node for scroll-syncing the fixed axis
    vis.wrapperNode = wrapper.node();
    if (vis.wrapperNode) {
      vis.wrapperNode.addEventListener('scroll', () => {
        // translate the fixed axis horizontally to match the scrollLeft
        if (vis.fixedXAxisG) {
          const sx = vis.wrapperNode.scrollLeft || 0;
          vis.fixedXAxisG.attr('transform', `translate(${vis.config.margin.left - sx},20)`);
        }
      });
    }

    vis.svg = wrapper.append('svg')
      .attr('width',  vis.config.containerWidth)
      .attr('height', vis.config.containerHeight)
      .style('background', '#333');

    // fixed bottom x-axis SVG (sticky at bottom of the wrapper)
    vis.fixedAxisSvg = wrapper.append('svg')
      .attr('class', 'x-axis-fixed-svg')
      .attr('width', vis.config.containerWidth)
      .attr('height', 40)
      .style('background', 'transparent');

    vis.fixedXAxisG = vis.fixedAxisSvg.append('g')
      .attr('transform', `translate(${vis.config.margin.left},20)`);

    // X-axis brush for drag-to-zoom (on the fixed axis area)
    vis.xBrush = d3.brushX()
      .extent([[0, 0], [vis.width, 40]])
      .on('end', event => vis.xZoomed(event));

    vis.fixedAxisSvg.append('g')
      .attr('class', 'x-brush')
      .attr('transform', `translate(${vis.config.margin.left},0)`) // align with axis
      .call(vis.xBrush);

    // double-click fixed axis to reset zoom (also attach to visible SVG and wrapper for reliability)
    vis.fixedAxisSvg.on('dblclick', () => vis.resetZoom && vis.resetZoom());
    // ensure dblclick works when user clicks the chart area or wrapper
    wrapper.on('dblclick', () => vis.resetZoom && vis.resetZoom());
    vis.svg.on('dblclick', () => vis.resetZoom && vis.resetZoom());

    vis.chart = vis.svg.append('g')
      .attr('transform', `translate(${vis.config.margin.left},${vis.config.margin.top})`);

    vis.xScale = d3.scaleLinear().range([0, vis.width]);
    vis.yScale = d3.scaleBand().range([0, vis.height]).paddingInner(0.15);

    // If external colorScale is provided, use it directly without modification
    if (vis.config.colorScale) {
      vis.colorScale = vis.config.colorScale;
    } else {
      // Create a local colorScale if none provided
      const createDistinctPalette = count => {
        const palette = [
          ...d3.schemeTableau10,
          ...d3.schemeSet3,
          ...d3.schemePaired
        ];
        return palette.slice(0, Math.max(0, count));
      };

      vis.colorScale = d3.scaleOrdinal()
        .domain(vis.config.energyTypes)
        .range(createDistinctPalette(vis.config.energyTypes.length));
    }

    // optional color map keyed by normalized type name for robust matching
    vis.colorMap = vis.config.colorMap || null;

    const normalize = s => s ? String(s).toLowerCase().replace(/[^a-z0-9]/g, '') : '';
    const getColor = t => {
      if (!t) return '#888';
      if (vis.colorMap) {
        const c = vis.colorMap[normalize(t)];
        if (c) return c;
      }
      const color = vis.colorScale(t);
      return color;
    };
    vis.getColor = getColor;

    vis.xAxisG = vis.chart.append('g')
      .attr('class', 'x-axis')
      .attr('transform', `translate(0,${vis.height})`)
      .attr('display', 'none'); // hidden: we use the fixed bottom axis instead

    vis.xAxisTopG = vis.chart.append('g')
      .attr('class', 'x-axis-top')
      .attr('transform', 'translate(0,0)');

    // Top-axis brush for drag-to-zoom (aligns over the top axis area)
    vis.topXBrush = d3.brushX()
      .extent([[0, 0], [vis.width, 40]])
      .on('end', event => vis.xTopZoomed(event));

    vis.chart.append('g')
      .attr('class', 'x-top-brush')
      .attr('transform', `translate(0, -20)`) // position over the top axis
      .call(vis.topXBrush);

    // double-click top axis to reset zoom
    vis.xAxisTopG.on('dblclick', () => vis.resetZoom && vis.resetZoom());

    vis.yAxisG = vis.chart.append('g')
      .attr('class', 'y-axis');

    vis.brush = d3.brushY()
      .extent([[0, 0], [vis.width, vis.height]])
      .on('brush end', event => vis.brushed(event));

    vis.brushG = vis.chart.append('g')
      .attr('class', 'brush')
      .call(vis.brush);

    vis.tooltip = d3.select('#tooltip').node()
      ? d3.select('#tooltip')
      : d3.select('body').append('div').attr('id', 'tooltip');

    if (vis.config.isStacked && vis.config.showLegend) {
      vis._buildLegend();
    }

    vis.updateVis();
  }

  _buildLegend() {
    let vis = this;
    const legendG = vis.chart.append('g')
      .attr('class', 'legend')
      .attr('transform', `translate(${vis.width + 5}, 10)`);

    vis.config.energyTypes.forEach((t, i) => {
      const row = legendG.append('g').attr('transform', `translate(0, ${i * 18})`);
      row.append('rect').attr('width', 12).attr('height', 12).attr('fill', vis.getColor(t));
      row.append('text')
        .attr('x', 16).attr('y', 10)
        .style('font-size', '11px').style('fill', '#eee')
        .text(t);
    });
  }

  updateVis(selectedType = null) {
    let vis = this;
    vis.selectedType = selectedType;

    if (vis.config.isStacked) {
      vis.stack = d3.stack().keys(vis.config.energyTypes);
      vis.stackedData = vis.stack(vis.data);
      const maxValue = d3.max(vis.data, d =>
        vis.config.energyTypes.reduce((acc, k) => acc + (+d[k] || 0), 0)
      ) || 1;
      vis.xScale.domain([0, maxValue]);
      // save the full domain for reset
      vis.fullXDomain = vis.xScale.domain().slice();
    } else {
      const maxValue = d3.max(vis.data, d => +d[vis.selectedType] || 0) || 1;
      vis.xScale.domain([0, maxValue]);
      vis.fullXDomain = vis.xScale.domain().slice();
    }

    

    vis.data.sort((a, b) => {
      if (vis.config.isStacked) {
        const ta = vis.config.energyTypes.reduce((s, k) => s + (+a[k] || 0), 0);
        const tb = vis.config.energyTypes.reduce((s, k) => s + (+b[k] || 0), 0);
        return tb - ta;
      }
      return (+b[vis.selectedType] || 0) - (+a[vis.selectedType] || 0);
    });

    vis.yScale.domain(vis.data.map(d => d.Entity));
    vis.renderVis();
  }

  renderVis() {
    let vis = this;

    if (vis.config.isStacked) {
      const layers = vis.chart.selectAll('.layer')
        .data(vis.stackedData, d => d.key)
        .join('g')
          .attr('class', 'layer')
          .attr('fill', d => vis.getColor(d.key));

      layers.selectAll('rect')
        .data(d => d.map(v => ({ ...v, key: d.key })))
        .join('rect')
          .attr('y',      d => vis.yScale(d.data.Entity))
          .attr('x',      d => vis.xScale(d[0]))
          .attr('width',  d => Math.max(0, vis.xScale(d[1]) - vis.xScale(d[0])))
          .attr('height', vis.yScale.bandwidth())
          .attr('opacity', d => vis.selectedCountries.size === 0 ? 1 : (vis.selectedCountries.has(d.data.Entity) ? 1 : 0.15))
          .on('click', (event, d) => {
            event.stopPropagation();
            const countryName = d.data.Entity;
            const newSelection = new Set();
            if (vis.selectedCountries.has(countryName)) {
              // If already selected, deselect it
              newSelection.clear();
            } else {
              // Select only this country
              newSelection.add(countryName);
            }
            if (window.SelectionManager) {
              window.SelectionManager.setSelection(newSelection);
            }
          })
          .on('mouseover', (event, d) => {
            // Build a detailed breakdown for the country (all energy types)
            const row = d.data;
            const types = vis.config.energyTypes || [];
            const rowsHtml = types.map(t => {
              const v = (+row[t] || 0).toFixed(2);
              return `<div style="margin:2px 0;"><strong>${t}:</strong> ${v} ${vis.config.unit}</div>`;
            }).join('');
            const total = types.reduce((s, t) => s + (+row[t] || 0), 0).toFixed(2);
            vis.tooltip
              .style('display', 'block')
              .style('left', (event.pageX + 10) + 'px')
              .style('top',  (event.pageY - 28) + 'px')
              .html(`<strong>${row.Entity}</strong><br/><div style="margin-top:6px;">${rowsHtml}</div><div style="margin-top:6px;"><strong>Total:</strong> ${total} ${vis.config.unit}</div>`);
          })
          .on('mousemove', event => {
            vis.tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 28) + 'px');
          })
          .on('mouseout', () => vis.tooltip.style('display', 'none'));

    } else {
      vis.chart.selectAll('.bar')
        .data(vis.data, d => d.Entity)
        .join('rect')
          .attr('class', 'bar')
          .attr('y',      d => vis.yScale(d.Entity))
          .attr('x',      0)
          .attr('width',  d => vis.xScale(+d[vis.selectedType] || 0))
          .attr('height', vis.yScale.bandwidth())
          .attr('fill',   vis.getColor(vis.selectedType))
          .attr('opacity', d => vis.selectedCountries.size === 0 ? 1 : (vis.selectedCountries.has(d.Entity) ? 1 : 0.15))
          .on('click', (event, d) => {
            event.stopPropagation();
            const countryName = d.Entity;
            const newSelection = new Set();
            if (vis.selectedCountries.has(countryName)) {
              // If already selected, deselect it
              newSelection.clear();
            } else {
              // Select only this country
              newSelection.add(countryName);
            }
            if (window.SelectionManager) {
              window.SelectionManager.setSelection(newSelection);
            }
          })
          .on('mouseover', (event, d) => {
            vis.tooltip
              .style('display', 'block')
              .style('left', (event.pageX + 10) + 'px')
              .style('top',  (event.pageY - 28) + 'px')
              .html(`<strong>${d.Entity}</strong><br/>${vis.selectedType}: ${(+d[vis.selectedType] || 0).toFixed(2)} ${vis.config.unit}`);
          })
          .on('mousemove', event => {
            vis.tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 28) + 'px');
          })
          .on('mouseout', () => vis.tooltip.style('display', 'none'));
    }

    const tickFmt = d => d >= 1000 ? `${(d/1000).toFixed(0)}k` : d;

    // render the fixed bottom axis (sticky) and style it
    vis.fixedXAxisG.call(d3.axisBottom(vis.xScale).ticks(6).tickFormat(tickFmt));
    vis.fixedXAxisG.selectAll('text').style('fill', '#eee');
    vis.fixedXAxisG.selectAll('line, path').style('stroke', '#888');

    // keep the top axis for reference inside the chart
    vis.xAxisTopG.call(d3.axisTop(vis.xScale).ticks(6).tickFormat(tickFmt));
    vis.xAxisTopG.selectAll('text').style('fill', '#eee');
    vis.xAxisTopG.selectAll('line, path').style('stroke', '#888');

    vis.yAxisG.call(d3.axisLeft(vis.yScale).tickSize(0));
    vis.yAxisG.selectAll('text').style('fill', '#eee').style('font-size', '11px');
    vis.yAxisG.selectAll('line, path').style('stroke', '#888');
  }

  brushed(event) {
    let vis = this;
    if (!event.selection) {
      // Clear selection when brush is cleared
      vis.selectedCountries.clear();
      vis.chart.selectAll('rect.bar, .layer rect').attr('opacity', 1);
      // Notify SelectionManager
      if (window.SelectionManager) {
        window.SelectionManager.setSelection(new Set());
      }
      return;
    }
    const [y0, y1] = event.selection;
    const selectedCountries = new Set(
      vis.yScale.domain().filter(entity => {
        const mid = vis.yScale(entity) + vis.yScale.bandwidth() / 2;
        return mid >= y0 && mid <= y1;
      })
    );
    vis.selectedCountries = selectedCountries;
    
    if (vis.config.isStacked) {
      vis.chart.selectAll('.layer rect')
        .attr('opacity', d => selectedCountries.has(d.data.Entity) ? 1 : 0.15);
    } else {
      vis.chart.selectAll('rect.bar')
        .attr('opacity', d => selectedCountries.has(d.Entity) ? 1 : 0.15);
    }
    console.log('Brushed countries:', [...selectedCountries]);
    
    // Notify SelectionManager of the selection
    if (window.SelectionManager) {
      window.SelectionManager.setSelection(selectedCountries);
    }
  }

  // Method to apply external selection from SelectionManager
  applySelection(selectedCountries) {
    let vis = this;
    vis.selectedCountries = selectedCountries;
    if (selectedCountries.size === 0) {
      vis.chart.selectAll('rect.bar, .layer rect').attr('opacity', 1);
    } else {
      if (vis.config.isStacked) {
        vis.chart.selectAll('.layer rect')
          .attr('opacity', d => selectedCountries.has(d.data.Entity) ? 1 : 0.15);
      } else {
        vis.chart.selectAll('rect.bar')
          .attr('opacity', d => selectedCountries.has(d.Entity) ? 1 : 0.15);
      }
    }
  }

  // Handle x-axis brush end to perform zoom
  xZoomed(event) {
    const vis = this;
    if (!event.selection || event.selection.length === 0) {
      return;
    }
    const [x0, x1] = event.selection; // coordinates relative to axis group
    // compute new domain (invert using current scale)
    const d0 = vis.xScale.invert(x0);
    const d1 = vis.xScale.invert(x1);
    if (d0 == null || d1 == null) return;
    vis.xScale.domain([Math.min(d0, d1), Math.max(d0, d1)]);
    // re-render chart with new x domain
    vis.renderVis();
    // clear the brush selection visually
    vis.fixedAxisSvg.select('.x-brush').call(vis.xBrush.move, null);
  }

  // Reset to full x-domain
  resetZoom() {
    const vis = this;
    if (vis.fullXDomain) {
      vis.xScale.domain(vis.fullXDomain.slice());
      vis.renderVis();
    }
  }

  // clear brush visuals for both top and bottom brushes
  _clearBrushVisuals() {
    const vis = this;
    try {
      if (vis.fixedAxisSvg) vis.fixedAxisSvg.select('.x-brush').call(vis.xBrush.move, null);
    } catch (e) {}
    try {
      if (vis.chart) vis.chart.select('.x-top-brush').call(vis.topXBrush.move, null);
    } catch (e) {}
  }

  // Handle top-axis brush end (same behavior as bottom brush)
  xTopZoomed(event) {
    const vis = this;
    if (!event.selection || event.selection.length === 0) {
      return;
    }
    const [x0, x1] = event.selection; // coordinates relative to chart group (we positioned brush accordingly)
    const d0 = vis.xScale.invert(x0);
    const d1 = vis.xScale.invert(x1);
    if (d0 == null || d1 == null) return;
    vis.xScale.domain([Math.min(d0, d1), Math.max(d0, d1)]);
    vis.renderVis();
    // clear the top brush visually
    vis.chart.select('.x-top-brush').call(vis.topXBrush.move, null);
    // also clear bottom brush visuals to keep UI consistent
    vis.fixedAxisSvg.select('.x-brush').call(vis.xBrush.move, null);
  }
}


// ── Scatterplot: total energy (TWh) vs per-capita energy (kWh/capita) ──────
class Scatterplot {
  constructor(_config, _totalData, _perCapitaData) {
    this.config = {
      parentElement: _config.parentElement,
      containerWidth:  _config.containerWidth  || 900,
      containerHeight: _config.containerHeight || 550,
      margin: _config.margin || { top: 30, right: 40, bottom: 60, left: 80 }
    };
    

    const pcMap = {};
    _perCapitaData.forEach(d => { pcMap[d.Entity] = d; });

    const totalKeys = _totalData.length > 0
      ? Object.keys(_totalData[0]).filter(k => !['Entity','Code','Year'].includes(k))
      : [];
    const pcKeys = _perCapitaData.length > 0
      ? Object.keys(_perCapitaData[0]).filter(k => !['Entity','Code','Year'].includes(k))
      : [];

    this.data = _totalData.map(d => {
      const pc = pcMap[d.Entity];
      if (!pc) return null;
      const totalTWh = totalKeys.reduce((s, k) => s + (+d[k] || 0), 0);
      const totalPC  = pcKeys.reduce((s, k) => s + (+pc[k] || 0), 0);
      if (!totalTWh || !totalPC) return null;
      return { Entity: d.Entity, totalTWh, totalPC };
    }).filter(Boolean);

    this.selectedCountries = new Set(); // Track current selection
    this.initVis();
    // Register this chart with the global SelectionManager
    if (window.SelectionManager) {
      window.SelectionManager.registerChart(this);
    }
  }

  initVis() {
    let vis = this;
    vis.width  = vis.config.containerWidth  - vis.config.margin.left - vis.config.margin.right;
    vis.height = vis.config.containerHeight - vis.config.margin.top  - vis.config.margin.bottom;

    const wrapper = d3.select(vis.config.parentElement)
      .append('div')
      .attr('class', 'chart-shell')
      .style('width', '100%')
      .style('height', '100%')
      .style('overflow', 'auto')
      .style('display', 'flex')
      .style('flex-direction', 'column');

    vis.svg = wrapper.append('svg')
        .attr('width',  vis.config.containerWidth)
        .attr('height', vis.config.containerHeight)
        .style('background', '#333');

    // scatterplot uses internal axes (no fixed/sticky bottom axis)

    vis.chart = vis.svg.append('g')
      .attr('transform', `translate(${vis.config.margin.left},${vis.config.margin.top})`);

    vis.xScale = d3.scaleLinear().range([0, vis.width]);
    vis.yScale = d3.scaleLinear().range([vis.height, 0]);

    vis.xAxisG = vis.chart.append('g').attr('class', 'x-axis')
      .attr('transform', `translate(0,${vis.height})`);
    vis.yAxisG = vis.chart.append('g').attr('class', 'y-axis');

    vis.chart.append('text')
      .attr('x', vis.width / 2).attr('y', vis.height + 50)
      .attr('text-anchor', 'middle')
      .style('fill', '#eee').style('font-size', '13px')
      .text('Total Energy (TWh)');

    vis.chart.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('x', -vis.height / 2).attr('y', -60)
      .attr('text-anchor', 'middle')
      .style('fill', '#eee').style('font-size', '13px')
      .text('Per-Capita Energy (kWh/capita)');

    vis.brush = d3.brush()
      .extent([[0, 0], [vis.width, vis.height]])
      .on('brush end', event => vis.brushed(event));

    vis.brushG = vis.chart.append('g').attr('class', 'brush').call(vis.brush);

    vis.tooltip = d3.select('#tooltip').node()
      ? d3.select('#tooltip')
      : d3.select('body').append('div').attr('id', 'tooltip');

    vis.renderVis();
  }

  renderVis() {
    let vis = this;
    const valid = vis.data.filter(d => d.totalTWh > 0 && d.totalPC > 0);

    vis.xScale.domain(d3.extent(valid, d => d.totalTWh)).nice();
    vis.yScale.domain(d3.extent(valid, d => d.totalPC)).nice();

    vis.chart.selectAll('.dot')
      .data(valid, d => d.Entity)
      .join('circle')
        .attr('class', 'dot')
        .attr('cx', d => vis.xScale(d.totalTWh))
        .attr('cy', d => vis.yScale(d.totalPC))
        .attr('r', 5)
        .attr('fill', '#4e9af1')
        .attr('opacity', d => vis.selectedCountries.size === 0 ? 0.8 : (vis.selectedCountries.has(d.Entity) ? 1 : 0.1))
        .on('click', (event, d) => {
          event.stopPropagation();
          const countryName = d.Entity;
          const newSelection = new Set();
          if (vis.selectedCountries.has(countryName)) {
            // If already selected, deselect it
            newSelection.clear();
          } else {
            // Select only this country
            newSelection.add(countryName);
          }
          if (window.SelectionManager) {
            window.SelectionManager.setSelection(newSelection);
          }
        })
        .on('mouseover', (event, d) => {
          vis.tooltip
            .style('display', 'block')
            .style('left', (event.pageX + 10) + 'px')
            .style('top',  (event.pageY - 28) + 'px')
            .html(`<strong>${d.Entity}</strong><br/>
                   Total: ${d.totalTWh.toFixed(1)} TWh<br/>
                   Per Capita: ${d.totalPC.toFixed(0)} kWh/capita`);
        })
        .on('mousemove', event => {
          vis.tooltip.style('left', (event.pageX + 10) + 'px').style('top', (event.pageY - 28) + 'px');
        })
        .on('mouseout', () => vis.tooltip.style('display', 'none'));

    const fmt = d3.format('~s');
    // render bottom axis inside the chart for a normal scatterplot appearance
    vis.xAxisG.call(d3.axisBottom(vis.xScale).ticks(6).tickFormat(fmt));
    vis.xAxisG.selectAll('text').style('fill', '#eee');
    vis.xAxisG.selectAll('line, path').style('stroke', '#888');

    vis.yAxisG.call(d3.axisLeft(vis.yScale).ticks(6).tickFormat(fmt));
    vis.yAxisG.selectAll('text').style('fill', '#eee');
    vis.yAxisG.selectAll('line, path').style('stroke', '#888');
  }

  brushed(event) {
    let vis = this;
    if (!event.selection) {
      vis.selectedCountries.clear();
      vis.chart.selectAll('.dot').attr('opacity', 0.8);
      // Notify SelectionManager
      if (window.SelectionManager) {
        window.SelectionManager.setSelection(new Set());
      }
      return;
    }
    const [[x0, y0], [x1, y1]] = event.selection;
    const selectedCountries = new Set();
    
    vis.chart.selectAll('.dot').attr('opacity', d => {
      const cx = vis.xScale(d.totalTWh);
      const cy = vis.yScale(d.totalPC);
      const inBrush = (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1);
      if (inBrush) {
        selectedCountries.add(d.Entity);
      }
      return inBrush ? 1 : 0.1;
    });
    
    vis.selectedCountries = selectedCountries;
    console.log('Scatterplot brushed countries:', [...selectedCountries]);
    
    // Notify SelectionManager of the selection
    if (window.SelectionManager) {
      window.SelectionManager.setSelection(selectedCountries);
    }
  }

  // Method to apply external selection from SelectionManager
  applySelection(selectedCountries) {
    let vis = this;
    vis.selectedCountries = selectedCountries;
    if (selectedCountries.size === 0) {
      vis.chart.selectAll('.dot').attr('opacity', 0.8);
    } else {
      vis.chart.selectAll('.dot').attr('opacity', d => 
        selectedCountries.has(d.Entity) ? 1 : 0.1
      );
    }
  }
}
