//test if browser supports webGL

if(Modernizr.webgl) {

	//setup pymjs
	var pymChild = new pym.Child();

	//Load data and config file
	d3.queue()
		.defer(d3.csv, "data/data.csv")
		.defer(d3.csv, "data/data_with_names.csv")
		.defer(d3.csv, "data/metadata.csv")
		.defer(d3.json, "data/config.json")
		.defer(d3.json, "data/geog.json")
		.await(ready);


	function ready (error, data, data_with_names, metadata, config, geog){

		//Set up global variables
		dvc = config.ons;
		oldAREACD = "";
		selected = false;
		firsthover = true;

		//Get column names
		variables = [];
		for (var column in data[0]) {
			if (column == 'AREACD') continue;
			if (column == 'AREANM') continue;
			variables.push(column);
		}

		a = dvc.varload;

		if(dvc.varlabels.length > 1)	{
			buildNav();
		}

		document.title = dvc.maptitle;

		selectlist(data);

		//set up basemap
		map = new mapboxgl.Map({
		  container: 'map', // container id
		  style: 'data/style.json', //stylesheet location //includes key for API
		  center: [-2.5, 54], // starting position
		  minZoom: 3.5,//
		  zoom: 4.5, // starting zoom
		  maxZoom: 13, //
		  attributionControl: false //
		});
		//add fullscreen option
		//map.addControl(new mapboxgl.FullscreenControl());

		// Add zoom and rotation controls to the map.
		map.addControl(new mapboxgl.NavigationControl());

		// Disable map rotation using right click + drag
		map.dragRotate.disable();

		// Disable map rotation using touch rotation gesture
		map.touchZoomRotate.disableRotation();

		// Add geolocation controls to the map.
		map.addControl(new mapboxgl.GeolocateControl({
			positionOptions: {
				enableHighAccuracy: true
			}
		}));

		//add compact attribution
		map.addControl(new mapboxgl.AttributionControl({
			compact: true
		}));

		//get location on click
		d3.select(".mapboxgl-ctrl-geolocate").on("click",geolocate);

		//addFullscreen();

		defineBreaks();

		setupScales();

		//now ranges are set we can call draw the key
		createKey(config);

		//convert topojson to geojson
		for(key in geog.objects){
			var areas = topojson.feature(geog, geog.objects[key])
		}

		//Work out extend of loaded geography file so we can set map to fit total extent
		bounds = turf.extent(areas);

		//set map to total extent
		setTimeout(function(){
			map.fitBounds([[bounds[0],bounds[1]], [bounds[2], bounds[3]]])
		},1000);



		//and add properties to the geojson based on the csv file we've read in
		areas.features.map(function(d,i) {
		  if(!isNaN(rateById[d.properties.AREACD]))
		  	{d.properties.fill = color(rateById[d.properties.AREACD])}
		  else {d.properties.fill = '#ccc'};
		});

		map.on('load', defineLayers);

		if ($('html').hasClass('touch')) {
			map.scrollZoom.disable();
			map.dragPan.disable();
		};

		function buildNav() {

			fieldset=d3.select('#nav').append('fieldset');

			fieldset
			.append('legend')
			.attr('class','visuallyhidden')
			.html('Choose a variable');

			fieldset
			.append("div")
			.attr('class','visuallyhidden')
			.attr('aria-live','polite')
			.append('span')
			.attr('id','selected');

			grid=fieldset.append('div')
			.attr('class','grid grid--full large-grid--fit');

			cell=grid.selectAll('div')
			.data(dvc.varlabels)
			.enter()
			.append('div')
			.attr('class','grid-cell');

			cell.append('input')
			.attr('type','radio')
			.attr('class','visuallyhidden')
			.attr('id',function(d,i){return 'button'+i;})
			.attr('value',function(d,i){return i;})
			.attr('name','button');

			cell.append('label')
			.attr('for',function(d,i){return 'button'+i;})
			.append('div')
					.html(function(d){return d;});

			d3.selectAll('input[type="radio"]').on('change', function(d) {
				onchange(document.querySelector('input[name="button"]:checked').value);
				d3.select('#selected').text(dvc.varlabels[document.querySelector('input[name="button"]:checked').value] + " is selected");
			});

			d3.select('#button'+dvc.varload).property('checked',true);
			d3.select('#selected').text(dvc.varlabels[document.querySelector('input[name="button"]:checked').value] + " is selected");

		d3.select('#selectnav').append('label')
		.attr('for','dropdown')
		.attr('class','visuallyhidden')
		.text('Choose a variable')

		selectgroup = d3.select('#selectnav')
						.append('select')
						.attr('class','dropdown')
						.attr('id','dropdown')
						.on('change', onselect)
						.selectAll("option")
						.data(dvc.varlabels)
						.enter()
						.append('option')
						.attr("value", function(d,i){return i})
						.property("selected", function(d, i) {return i===dvc.varload;})
						.text(function(d,i){return dvc.varlabels[i]});


		}

		function defineBreaks(){

			rateById = {};
			areaById = {};

			data.forEach(function(d) {rateById[d.AREACD] = +d[variables[a]]; areaById[d.AREACD] = d.AREANM}); //change to brackets


			//Flatten data values and work out breaks
			if(config.ons.breaks[a] =="jenks" || config.ons.breaks[a] =="equal") {
				var values =  data.map(function(d) { return +d[variables[a]]; }).filter(function(d) {return !isNaN(d)}).sort(d3.ascending);
			};

			if(config.ons.breaks[a] =="jenks") {
				breaks = [];

				ss.ckmeans(values, (dvc.numberBreaks[a])).map(function(cluster,i) {
					if(i<dvc.numberBreaks[a]-1) {
						breaks.push(cluster[0]);
					} else {
						breaks.push(cluster[0])
						//if the last cluster take the last max value
						breaks.push(cluster[cluster.length-1]);
					}
				});
			}
			else if (config.ons.breaks[a] == "equal") {
				breaks = ss.equalIntervalBreaks(values, dvc.numberBreaks[a]);
			}
			else {breaks = config.ons.breaks[a];};


			//round breaks to specified decimal places
			breaks = breaks.map(function(each_element){
				return Number(each_element.toFixed(dvc.legenddecimals));
			});

			//work out halfway point (for no data position)
			midpoint = breaks[0] + ((breaks[dvc.numberBreaks[a]] - breaks[0])/2)

		}

		function setupScales() {
			//set up d3 color scales
			color = d3.scaleThreshold()
					// Clusters
					.domain([0,1,2,3,4,5,6,7])
					// Qualitative color palette for all color-vision deficiencies (Okabe and Ito 2008)
					.range(["#E69F00", "#56B4E9", "#009E73", "#F0E442", "#0072B2", "#D55E00", "#CC79A7", "#000000"]);
		}

		function defineLayers() {

			map.addSource('area', { 'type': 'geojson', 'data': areas });

			  map.addLayer({
				  'id': 'area',
				  'type': 'fill',
				  'source': 'area',
				  'touchAction':'none',
				  'layout': {},
				  'paint': {
					  'fill-color': {
							type: 'identity',
							property: 'fill'
					   },
					  'fill-opacity': 0.8,
					  'fill-outline-color': '#fff'
				  }
			  }, 'place_city');

			//Get current year for copyright
			today = new Date();
			copyYear = today.getFullYear();
			map.style.sourceCaches['area']._source.attribution = "Contains OS data &copy; Crown copyright and database right " + copyYear;

			map.addLayer({
				"id": "state-fills-hover",
				"type": "line",
				"source": "area",
				"layout": {},
				"paint": {
					"line-color": "#000",
					"line-width": 2
				},
				"filter": ["==", "AREACD", ""]
			}, 'place_city');

			  map.addLayer({
				  'id': 'area_labels',
				  'type': 'symbol',
				  'source': 'area',
				  'minzoom': 10,
				  'layout': {
					  "text-field": '{AREANM}',
					  "text-font": ["Open Sans","Arial Unicode MS Regular"],
					  "text-size": 16
				  },
				  'paint': {
					  "text-color": "#666",
					  "text-halo-color": "#fff",
					  "text-halo-width": 1,
					  "text-halo-blur": 1
				  }
			  });


			//test whether ie or not
			function detectIE() {
				  var ua = window.navigator.userAgent;

				  var msie = ua.indexOf('MSIE ');
				  if (msie > 0) {
					// IE 10 or older => return version number
					return parseInt(ua.substring(msie + 5, ua.indexOf('.', msie)), 10);
				  }

				  var trident = ua.indexOf('Trident/');
				  if (trident > 0) {
					// IE 11 => return version number
					var rv = ua.indexOf('rv:');
					return parseInt(ua.substring(rv + 3, ua.indexOf('.', rv)), 10);
				  }

				  var edge = ua.indexOf('Edge/');
				  if (edge > 0) {
					// Edge (IE 12+) => return version number
					return parseInt(ua.substring(edge + 5, ua.indexOf('.', edge)), 10);
				  }

				  // other browser
				  return false;
			}


			if(detectIE()){
				onMove = onMove.debounce(200);
				onLeave = onLeave.debounce(200);
			};

			//Highlight stroke on mouseover (and show area information)
			map.on("mousemove", "area", onMove);

			// Reset the state-fills-hover layer's filter when the mouse leaves the layer.
			map.on("mouseleave", "area", onLeave);

			//Add click event
			map.on("click", "area", onClick);

		}


		function updateLayers() {

			//update properties to the geojson based on the csv file we've read in
			areas.features.map(function(d,i) {
			   if(!isNaN(rateById[d.properties.AREACD]))
			    {d.properties.fill = color(rateById[d.properties.AREACD])}
			   else {d.properties.fill = '#ccc'};

			});

			//Reattach geojson data to area layer
			map.getSource('area').setData(areas);

			//set up style object
			styleObject = {
									type: 'identity',
									property: 'fill'
						}
			//repaint area layer map usign the styles above
			map.setPaintProperty('area', 'fill-color', styleObject);

		}


		function onchange(i) {

			a = i;

			defineBreaks();
			setupScales();
			createKey(config);

			if(selected) {
				setAxisVal($('#areaselect option:selected').html(),$("#areaselect").val());
			}
			updateLayers();
		}

		function onselect() {
			a = $(".dropdown").val();
			onchange(a);
		}


		function onMove(e) {
			// console.log(e)

				map.getCanvasContainer().style.cursor = 'pointer';

				newAREACD = e.features[0].properties.AREACD;

				if(newAREACD != oldAREACD) {
					oldAREACD = e.features[0].properties.AREACD;
					map.setFilter("state-fills-hover", ["==", "AREACD", e.features[0].properties.AREACD]);

					selectArea(e.features[0].properties.AREACD);
					setAxisVal(e.features[0].properties.AREANM,e.features[0].properties.AREACD);

				}
		};


		function onLeave() {
				map.getCanvasContainer().style.cursor = null;
				map.setFilter("state-fills-hover", ["==", "AREACD", ""]);
				oldAREACD = "";
				$("#areaselect").val(null).trigger('chosen:updated');
				hideaxisVal();
		};

		function onClick(e) {
				disableMouseEvents();
				newAREACD = e.features[0].properties.AREACD;

				if(newAREACD != oldAREACD) {
					oldAREACD = e.features[0].properties.AREACD;
					map.setFilter("state-fills-hover", ["==", "AREACD", e.features[0].properties.AREACD]);

					selectArea(e.features[0].properties.AREACD);
					setAxisVal(e.features[0].properties.AREANM,e.features[0].properties.AREACD);
				}

				dataLayer.push({
            'event':'mapClickSelect',
            'selected': newAREACD
        })
		};

		function disableMouseEvents() {
				map.off("mousemove", "area", onMove);
				map.off("mouseleave", "area", onLeave);

				selected = true;
		}

		function enableMouseEvents() {
				map.on("mousemove", "area", onMove);
				map.on("click", "area", onClick);
				map.on("mouseleave", "area", onLeave);

				selected = false;
		}

		function selectArea(code) {
			$("#areaselect").val(code).trigger('chosen:updated');
			d3.select('abbr').on('keypress',function(evt){
				if(d3.event.keyCode==13 || d3.event.keyCode==32){
					d3.event.preventDefault();
					onLeave();
					resetZoom();
				}
			})
		}


		function zoomToArea(code) {

			specificpolygon = areas.features.filter(function(d) {return d.properties.AREACD == code})

			specific = turf.extent(specificpolygon[0].geometry);

			map.fitBounds([[specific[0],specific[1]], [specific[2], specific[3]]], {
  				padding: {top: 150, bottom:150, left: 100, right: 100}
			});

		}

		function resetZoom() {

			map.fitBounds([[bounds[0], bounds[1]], [bounds[2], bounds[3]]]);

		}


		function createKey(config) {
			keywidth = d3.select("#keydiv").node().getBoundingClientRect().width;

			var svgkey = d3.select("#keydiv")
				.attr("width", keywidth);

			d3.select("#keydiv")
				.style("font-family", "Open Sans")
				.style("font-size", "14px")
				.append("p")
				.attr("id", "keyvalue")
				.style("font-size", "15px")
				.style("margin-top", "10px")
				.style("margin-bottom", "5px")
				.style("margin-left", "10px")
				.text("")
		}

		groups=["Headline","Economy","Connectivity","Education","Skills","Health","Wellbeing"]

		function setAxisVal(areanm, areacd, areaval2) {
			if(data.filter(d=>d.AREACD==areacd)[0][variables[a]] != 'null') { // not fixed!
				d3.select("#keyvalue")
				.html(areanm + " is in the<span style='font-weight:700'> " + data_with_names.filter(d=>d.AREACD==areacd)[0][variables[a]] + "cluster</span>")
				.append("p")
				.text("Local authorities in this cluster are:")
				.append("ul")
				.append("li")
				.html("Mostly situated in <span style='font-weight:700'>" + metadata.filter(d=>d.AREACD==areacd).filter(d=>d.Group==groups[a]).filter(d=>d.Category=='Region')[0].Value + "</span>")
				.append("li")
				.html(function(d) {
					if (metadata.filter(d=>d.AREACD==areacd).filter(d=>d.Group==groups[a]).filter(d=>d.Category=='urbanrural')[0].Value == "urban and rural") {return "Relatively balanced between <span style='font-weight:700'>" + metadata.filter(d=>d.AREACD==areacd).filter(d=>d.Group==groups[a]).filter(d=>d.Category=='urbanrural')[0].Value + "</span>"}
					else { return "Mostly <span style='font-weight:700'>" + metadata.filter(d=>d.AREACD==areacd).filter(d=>d.Group==groups[a]).filter(d=>d.Category=='urbanrural')[0].Value + "</span>" }
					;})
				.append("li")
				.html("Better than the median for <span style='font-weight:700'>" + metadata.filter(d=>d.AREACD==areacd).filter(d=>d.Group==groups[a]).filter(d=>d.Category=='AboveMedian')[0].Value + "</span>")
				.append("li")
				.html("Worse than the median for <span style='font-weight:700'>" + metadata.filter(d=>d.AREACD==areacd).filter(d=>d.Group==groups[a]).filter(d=>d.Category=='BelowMedian')[0].Value + "</span>")
				.append("p")
				.html("More detail on this cluster and other clusters can be found in the section below.")
			}
			else{
				d3.select("#keyvalue")
				.text("This local authority could not be assigned to a cluster. This could be due to:")
				.append("ul")
				.append("li")
				.text("Missing data for at least one metric")
				.append("li")
				.text("Data only being available at an older boundary date")
				.append("p")
				.text("More specific detail on why this local authority was excluded from our analysis can be found in our accompanying dataset.")
			}
		}

		function hideaxisVal() {
		  d3.select("#keyvalue").text("");
		  d3.select("#screenreadertext").text("");
		}

	pymChild.sendHeight();

	function addFullscreen() {

		currentBody = d3.select("#map").style("height");
		d3.select(".mapboxgl-ctrl-fullscreen").on("click", setbodyheight)

	}

	function setbodyheight() {
		d3.select("#map").style("height","100%");

		document.addEventListener('webkitfullscreenchange', exitHandler, false);
		document.addEventListener('mozfullscreenchange', exitHandler, false);
		document.addEventListener('fullscreenchange', exitHandler, false);
		document.addEventListener('MSFullscreenChange', exitHandler, false);

	}


	function exitHandler() {

			if (document.webkitIsFullScreen === false)
			{
				shrinkbody();
			}
			else if (document.mozFullScreen === false)
			{
				shrinkbody();
			}
			else if (document.msFullscreenElement === false)
			{
				shrinkbody();
			}
		}

	function shrinkbody() {
		d3.select("#map").style("height",currentBody);
		pymChild.sendHeight();
	}

	function geolocate() {
		dataLayer.push({
								'event': 'geoLocate',
								'selected': 'geolocate'
		})

		var options = {
		  enableHighAccuracy: true,
		  timeout: 5000,
		  maximumAge: 0
		};

		navigator.geolocation.getCurrentPosition(success, error, options);
	}

	function success(pos) {
	  crd = pos.coords;

	  //go on to filter
	  //Translate lng lat coords to point on screen
	  point = map.project([crd.longitude,crd.latitude]);

	  //then check what features are underneath
	  var features = map.queryRenderedFeatures(point);

	  //then select area
	  disableMouseEvents();

	  map.setFilter("state-fills-hover", ["==", "AREACD", features[0].properties.AREACD]);

	  selectArea(features[0].properties.AREACD);

	};

		function selectlist(datacsv) {

			var areacodes =  datacsv.map(function(d) { return d.AREACD; });
			var areanames =  datacsv.map(function(d) { return d.AREANM; });
			var menuarea = d3.zip(areanames,areacodes).sort(function(a, b){ return d3.ascending(a[0], b[0]); });

			// Build option menu for occupations
			var optns = d3.select("#selectNav").append("div").attr("id","sel").append("select")
				.attr("id","areaselect")
				.attr("style","width:calc(100% - 6px)")
				.attr("class","chosen-select");

			optns.append("option")
				// .attr("value","first")
				// .text("");

			optns.selectAll("p").data(menuarea).enter().append("option")
				.attr("value", function(d){ return d[1]})
				.attr("id",function(d){return d[1]})
				.text(function(d){ return d[0]});

			myId=null;

			 $('#areaselect').chosen({placeholder_text_single:"Select an area",allow_single_deselect:true})

			 d3.select('input.chosen-search-input').attr('id','chosensearchinput')
	     d3.select('div.chosen-search').insert('label','input.chosen-search-input').attr('class','visuallyhidden').attr('for','chosensearchinput').html("Type to select an area")

			$('#areaselect').on('change',function(){
					console.log()
					if($('#areaselect').val() != "") {
							areacode = $('#areaselect').val()

							disableMouseEvents();

							map.setFilter("state-fills-hover", ["==", "AREACD", areacode]);

							selectArea(areacode);
							setAxisVal($('#areaselect option:selected').html(),areacode)
							zoomToArea(areacode);

							dataLayer.push({
                  'event': 'mapDropSelect',
                  'selected': areacode
              })
					}
					else {
							dataLayer.push({
									'event': 'deselectCross',
									'selected': 'deselect'
							})

							enableMouseEvents();
							hideaxisVal();
							onLeave();
							resetZoom();
					}
			});
	};//end selectlist
}//end ready

} else {

	//provide fallback for browsers that don't support webGL
	d3.select('#map').remove();
	d3.select('body').append('p').html("Unfortunately your browser does not support WebGL. <a href='https://www.gov.uk/help/browsers' target='_blank>'>If you're able to please upgrade to a modern browser</a>")

}
