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
    this.initVis();
  }

  initVis() {
    let vis = this;
    vis.width  = vis.config.containerWidth  - vis.config.margin.left - vis.config.margin.right;
    vis.height = vis.config.containerHeight - vis.config.margin.top  - vis.config.margin.bottom;

    const wrapper = d3.select(vis.config.parentElement)
      .append('div')
      .style('width', '100%')
      .style('height', '100%')
      .style('overflow', 'hidden');

    vis.svg = wrapper.append('svg')
      .attr('width',  vis.config.containerWidth)
      .attr('height', vis.config.containerHeight)
      .style('background', '#333');

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
      .attr('transform', `translate(0,${vis.height})`);

    vis.xAxisTopG = vis.chart.append('g')
      .attr('class', 'x-axis-top')
      .attr('transform', 'translate(0,0)');

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
      vis.xScale.domain([0, d3.max(vis.data, d =>
        vis.config.energyTypes.reduce((acc, k) => acc + (+d[k] || 0), 0)
      )]);
    } else {
      vis.xScale.domain([0, d3.max(vis.data, d => +d[vis.selectedType] || 0)]);
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
          .attr('opacity', 1)
          .on('mouseover', (event, d) => {
            const segVal = (d[1] - d[0]).toFixed(2);
            vis.tooltip
              .style('display', 'block')
              .style('left', (event.pageX + 10) + 'px')
              .style('top',  (event.pageY - 28) + 'px')
              .html(`<strong>${d.data.Entity}</strong><br/>${d.key}: ${segVal} ${vis.config.unit}`);
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
          .attr('opacity', 1)
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

    vis.xAxisG.call(d3.axisBottom(vis.xScale).ticks(6).tickFormat(tickFmt));
    vis.xAxisG.selectAll('text').style('fill', '#eee');
    vis.xAxisG.selectAll('line, path').style('stroke', '#888');

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
      vis.chart.selectAll('rect.bar, .layer rect').attr('opacity', 1);
      return;
    }
    const [y0, y1] = event.selection;
    const selectedCountries = new Set(
      vis.yScale.domain().filter(entity => {
        const mid = vis.yScale(entity) + vis.yScale.bandwidth() / 2;
        return mid >= y0 && mid <= y1;
      })
    );
    if (vis.config.isStacked) {
      vis.chart.selectAll('.layer rect')
        .attr('opacity', d => selectedCountries.has(d.data.Entity) ? 1 : 0.15);
    } else {
      vis.chart.selectAll('rect.bar')
        .attr('opacity', d => selectedCountries.has(d.Entity) ? 1 : 0.15);
    }
    console.log('Brushed countries:', [...selectedCountries]);
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

    this.initVis();
  }

  initVis() {
    let vis = this;
    vis.width  = vis.config.containerWidth  - vis.config.margin.left - vis.config.margin.right;
    vis.height = vis.config.containerHeight - vis.config.margin.top  - vis.config.margin.bottom;

    vis.svg = d3.select(vis.config.parentElement)
      .append('svg')
        .attr('width',  vis.config.containerWidth)
        .attr('height', vis.config.containerHeight)
        .style('background', '#333');

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
        .attr('opacity', 0.8)
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
      vis.chart.selectAll('.dot').attr('opacity', 0.8);
      return;
    }
    const [[x0, y0], [x1, y1]] = event.selection;
    vis.chart.selectAll('.dot').attr('opacity', d => {
      const cx = vis.xScale(d.totalTWh);
      const cy = vis.yScale(d.totalPC);
      return (cx >= x0 && cx <= x1 && cy >= y0 && cy <= y1) ? 1 : 0.1;
    });
  }
}
