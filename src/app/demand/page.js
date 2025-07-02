"use client";

import 'mapbox-gl/dist/mapbox-gl.css';

import { useEffect, useRef, useState } from "react";
// Deterministically maps a string to a bright, high-contrast pastel color (for surveyor markers)
function stringToColor(str) {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = hash % 360;
  return `hsl(${hue}, 90%, 65%)`; // bright pastel tones
}
// Helper for consistent month-year labels
const monthsShort = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function formatMonthYear(date) {
  return `${monthsShort[date.getMonth()]} ${String(date.getFullYear()).slice(-2)}`;
}
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ResponsiveContainer
} from "recharts";
import mapboxgl from "mapbox-gl";
import { collection, getDocs, query, limit, where, orderBy } from "firebase/firestore";
import { db } from "../lib/firebase";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_ACCESS_TOKEN || "";

export default function DemandMapPage() {
  // Transform demand data into array for scatter chart per month/locality or voidType
  const buildScatterData = (demandDocs, keyField, startYear = 2024, startMonth = 3, monthsCount = 13) => {
    // Generate array of months strings YYYY-MM
    const months = Array.from({ length: monthsCount }, (_, i) => {
      const d = new Date(startYear, startMonth - 1 + i);
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    });

    // Unique keys (localities or voidTypes)
    const uniqueKeys = [...new Set(demandDocs.map(doc => doc[keyField] || "Unknown"))];

    // Build data array of objects, one object per month with counts for each key
    const data = months.map(month => {
      const monthData = { month };
      uniqueKeys.forEach(key => {
        monthData[key] = demandDocs.filter(doc => {
          const rawDate = doc["Tenancy end date"];
          if (!rawDate) return false;
          const d = new Date(rawDate);
          if (isNaN(d)) return false;
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          return ym === month && (doc[keyField] || "Unknown") === key;
        }).length;
      });
      return monthData;
    });

    return { data, uniqueKeys };
  };
  const mapContainerRef = useRef(null);
  // For live SOR submissions map
  const liveMapContainerRef = useRef(null);
  const liveMapRef = useRef(null);
  const [liveMapStyle, setLiveMapStyle] = useState("mapbox://styles/mapbox/light-v10");
  // Live SOR Submissions Map with filtering state
  const [liveSORs, setLiveSORs] = useState([]);
  const [filteredSORs, setFilteredSORs] = useState([]);
  const [visitTypeFilter, setVisitTypeFilter] = useState("All");
  const [voidTypeFilter, setVoidTypeFilter] = useState("All");
  const [surveyorFilter, setSurveyorFilter] = useState("All");

  // Date range filter state for Live SOR Submissions
  const [startDate, setStartDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().split("T")[0];
  });
  const [endDate, setEndDate] = useState(() => new Date().toISOString().split("T")[0]);

  // Fetch function for Live SOR Submissions, now depends on startDate/endDate
  async function fetchLiveSORs() {
    try {
      // Fetch all docs (client-side filter by submittedAt string)
      const snapshot = await getDocs(collection(db, "surveys"));

      const start = new Date(startDate);
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);

      const features = [];

      snapshot.forEach((doc) => {
        const data = doc.data();
        const coords = data?.location;
        const submitted = data?.submittedAt;

        if (!coords || !submitted) return;

        const submittedDate = new Date(submitted);
        if (submittedDate < start || submittedDate > end) return;

        const surveyor = data.surveyorName || "Unknown";
        const color = stringToColor(surveyor);
        const voidTime = data?.totals?.daysDecimal
          ? Number(data.totals.daysDecimal).toFixed(1)
          : "0.0";
        const totalCost = data?.totals?.cost
          ? Number(data.totals.cost).toFixed(2)
          : "0.00";

        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [coords.longitude, coords.latitude],
          },
          properties: {
            address: data.propertyAddress || "",
            surveyor,
            voidType: data.voidType || "Unknown",
            letType: data.visitType || "Unknown",
            color,
            voidTime,
            totalCost,
          },
        });
      });

      const geojson = {
        type: "FeatureCollection",
        features,
      };

      // If map and source exist, update data, else add source/layer
      const map = liveMapRef.current;
      if (map && map.getSource("liveDemand")) {
        map.getSource("liveDemand").setData(geojson);
      } else if (map) {
        map.addSource("liveDemand", {
          type: "geojson",
          data: geojson,
        });
        map.addLayer({
          id: "live-demand-points",
          type: "circle",
          source: "liveDemand",
          paint: {
            "circle-radius": 6,
            "circle-color": ["get", "color"],
            "circle-opacity": 0.6,
          },
        });
        map.on("click", "live-demand-points", (e) => {
          const props = e.features?.[0]?.properties;
          if (!props) return;
          new mapboxgl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(`
              <div>
                <strong>${props.address}</strong><br/>
                Surveyor: ${props.surveyor}<br/>
                Visit Type: ${props.letType}<br/>
                Void Type: ${props.voidType}<br/>
                Void Time: ${props.voidTime} days<br/>
                Total Cost: £${Number(props.totalCost).toFixed(2)}
              </div>
            `)
            .addTo(map);
        });
      }

      setLiveSORs(features);
      setFilteredSORs(features); // initial state matches full
    } catch (err) {
      console.error("Failed to fetch live SOR submissions:", err);
    }
  }

  useEffect(() => {
    if (!liveMapContainerRef.current) return;

    const map = new mapboxgl.Map({
      container: liveMapContainerRef.current,
      style: liveMapStyle,
      center: [-1.9, 52.5],
      zoom: 7,
    });
    liveMapRef.current = map;

    map.addControl(new mapboxgl.NavigationControl());

    fetchLiveSORs();
    // No cleanup needed as map instance is not reused
    // eslint-disable-next-line
  }, []);

  // Split handling of liveMapStyle and data updates for reliability and scalability
  // 1. Handle style changes and (re-)add source/layer/click handler
  useEffect(() => {
    const map = liveMapRef.current;
    if (!map) return;

    map.setStyle(liveMapStyle);

    map.once("style.load", () => {
      map.addSource("liveDemand", {
        type: "geojson",
        data: {
          type: "FeatureCollection",
          features: filteredSORs,
        },
      });

      map.addLayer({
        id: "live-demand-points",
        type: "circle",
        source: "liveDemand",
        paint: {
          "circle-radius": 6,
          "circle-color": ["get", "color"],
          "circle-opacity": 0.6,
        },
      });

      map.on("click", "live-demand-points", (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        new mapboxgl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`
            <div>
              <strong>${props.address}</strong><br/>
              Surveyor: ${props.surveyor}<br/>
              Visit Type: ${props.letType}<br/>
              Void Type: ${props.voidType}<br/>
              Void Time: ${props.voidTime} days<br/>
              Total Cost: £${Number(props.totalCost).toFixed(2)}
            </div>
          `)
          .addTo(map);
      });
    });
  }, [liveMapStyle]);

  // 2. Update data for liveDemand source without re-adding source/layer
  useEffect(() => {
    const map = liveMapRef.current;
    if (map?.getSource("liveDemand")) {
      map.getSource("liveDemand").setData({
        type: "FeatureCollection",
        features: filteredSORs,
      });
    }
  }, [filteredSORs]);

  // Filtering for live SORs
  useEffect(() => {
    const filtered = liveSORs.filter((f) => {
      const p = f.properties;
      return (
        (visitTypeFilter === "All" || p.letType === visitTypeFilter) &&
        (voidTypeFilter === "All" || p.voidType === voidTypeFilter) &&
        (
          surveyorFilter === "All" ||
          (p.surveyor?.trim().toLowerCase() === surveyorFilter.trim().toLowerCase())
        )
      );
    });

    const geojson = {
      type: "FeatureCollection",
      features: filtered,
    };

    const map = liveMapRef.current;
    if (map && map.getSource("liveDemand")) {
      map.getSource("liveDemand").setData(geojson);
    }
    setFilteredSORs(filtered);
  }, [visitTypeFilter, voidTypeFilter, surveyorFilter, liveSORs]);
  const [selectedLetType, setSelectedLetType] = useState("All");
  const [selectedVoidType, setSelectedVoidType] = useState("All");
  const [selectedLocality, setSelectedLocality] = useState("All");
  const [selectedMonth, setSelectedMonth] = useState("All");
  const [availableMonths, setAvailableMonths] = useState([]);
  const [visibleCount, setVisibleCount] = useState(0);
  const [breakdownStats, setBreakdownStats] = useState({});
  const [mapStyle, setMapStyle] = useState("mapbox://styles/mapbox/streets-v11");

  // Store fetched demand data in a ref so we only fetch once
  const demandDataRef = useRef(null);
  // Store the map instance in a ref
  const mapRef = useRef(null);

  // Fetch demand data ONCE and store in ref
  useEffect(() => {
    let ignore = false;
    async function fetchData() {
      if (demandDataRef.current) return;
      try {
        const snapshot = await getDocs(query(collection(db, "historicDemand"), limit(5000)));
        const docs = [];
        snapshot.forEach((doc) => {
          docs.push({ id: doc.id, ...doc.data() });
        });
        if (!ignore) demandDataRef.current = docs;
      } catch (err) {
        console.error("Failed to load demand data:", err);
      }
    }
    fetchData();
    return () => { ignore = true; };
  }, []);

  // Initialize the map and handle style changes
  useEffect(() => {
    if (!mapContainerRef.current) return;

    // Helper to add demand layers
    function addDemandLayers() {
      if (!demandDataRef.current) return;
      const getColorForLocality = (locality) => {
        switch (locality) {
          case "WOE": return "#1d4ed8";
          case "Glouc": return "#16a34a";
          case "S&M": return "#f59e0b";
          case "Central": return "#dc2626";
          default: return "#6b7280";
        }
      };
      const geojson = {
        type: "FeatureCollection",
        features: demandDataRef.current.map((data) => {
          const lat = parseFloat(data["Latitude"]);
          const lng = parseFloat(data["Longitude"]);
          if (isNaN(lat) || isNaN(lng)) return null;
          const locality = data["Locality"] || data["locality"] || "Unknown";
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [lng, lat] },
            properties: {
              color: getColorForLocality(locality),
              address: data["Address of property"] || "",
              postcode: data["Postcode"] || "",
              letType: data["Let Type"] || "Unknown",
              localAuth: data["Local Authority"] || "Unknown",
              voidType: data["Major or Minor void?"] || "Unknown",
              locality,
              tenancyEndDate: data["Tenancy end date"] || "Unknown",
            }
          };
        }).filter(Boolean),
      };
      if (mapRef.current.getSource("historicDemand")) {
        mapRef.current.getSource("historicDemand").setData(geojson);
      } else {
        mapRef.current.addSource("historicDemand", {
          type: "geojson",
          data: geojson,
        });
        mapRef.current.addLayer({
          id: "demand-points",
          type: "circle",
          source: "historicDemand",
          paint: {
            "circle-radius": 5,
            "circle-color": ["get", "color"],
            "circle-opacity": 0.7,
          },
        });
      }
    }

    if (mapRef.current) {
      // Change style if map already exists
      mapRef.current.setStyle(mapStyle);
    } else {
      // Create map instance
      const map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: mapStyle,
        center: [-1.9, 52.5],
        zoom: 7,
      });
      mapRef.current = map;
      window.mapRef = map;

      map.addControl(new mapboxgl.NavigationControl());

      // Add custom pitch control
      class PitchControl {
        onAdd(map) {
          this._map = map;
          this._container = document.createElement('div');
          this._container.className = 'mapboxgl-ctrl mapboxgl-ctrl-group';

          const button = document.createElement('button');
          button.innerHTML = "🛰️";
          button.title = "Toggle 3D angle";
          button.onclick = () => {
            const currentPitch = map.getPitch();
            map.easeTo({ pitch: currentPitch === 0 ? 60 : 0, duration: 1000 });
          };

          this._container.appendChild(button);
          return this._container;
        }

        onRemove() {
          this._container.parentNode.removeChild(this._container);
          this._map = undefined;
        }
      }
      map.addControl(new PitchControl(), "top-right");

      map.setPitch(0); // flat overhead
      map.setBearing(0); // north-up

      // Add click handler for popups
      map.on("click", "demand-points", (e) => {
        const props = e.features?.[0]?.properties;
        if (!props) return;
        new mapboxgl.Popup()
          .setLngLat(e.lngLat)
          .setHTML(`
            <div style="font-size: 14px; color: #111;">
              <strong style="font-size: 15px;">${props.address}</strong><br/>
              <span>Postcode: ${props.postcode}</span><br/>
              <span>Let Type: ${props.letType}</span><br/>
              <span>Local Authority: ${props.localAuth}</span><br/>
              <span>Void Type: ${props.voidType}</span><br/>
              <span>Locality: ${props.locality}</span><br/>
              <span>Est. Tenancy End: ${props.tenancyEndDate || "Unknown"}</span><br/>
            </div>
          `)
          .addTo(map);
      });
    }

    // Listen for style.load on every style change
    const map = mapRef.current;
    if (!map) return;
    function handleStyleLoad() {
      // Add DEM and 3D buildings
      if (!map.getSource('mapbox-dem')) {
        map.addSource('mapbox-dem', {
          type: 'raster-dem',
          url: 'mapbox://mapbox.terrain-rgb',
          tileSize: 512,
          maxzoom: 14
        });
      }
      if (!map.getTerrain()) {
        map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });
      }
      // Add 3D buildings if not already present
      if (!map.getLayer('3d-buildings')) {
        map.addLayer({
          id: '3d-buildings',
          source: 'composite',
          'source-layer': 'building',
          filter: ['==', 'extrude', 'true'],
          type: 'fill-extrusion',
          minzoom: 15,
          paint: {
            'fill-extrusion-color': '#aaa',
            'fill-extrusion-height': [
              "interpolate", ["linear"], ["zoom"],
              15, 0,
              15.05, ["get", "height"]
            ],
            'fill-extrusion-base': [
              "interpolate", ["linear"], ["zoom"],
              15, 0,
              15.05, ["get", "min_height"]
            ],
            'fill-extrusion-opacity': 0.6
          }
        });
      }
      // Add demand data layers
      addDemandLayers();
    }
    map.on("style.load", handleStyleLoad);

    // Call addDemandLayers if style is already loaded (e.g., on first mount)
    if (map.isStyleLoaded && map.isStyleLoaded()) {
      handleStyleLoad();
    }

    // Cleanup: remove style.load listener only
    return () => {
      map.off("style.load", handleStyleLoad);
      // Do not remove map instance unless component unmounts
    };
  }, [mapStyle]);

  // Update map data and stats whenever filters change or data loads
  useEffect(() => {
    const map = mapRef.current;
    const demandDocs = demandDataRef.current;
    if (!map || !demandDocs) return;
    // Force map render on initial load if no source yet: add all data to map source/layer
    if (!map.getSource("historicDemand") && demandDocs?.length > 0) {
      const getColorForLocality = (locality) => {
        switch (locality) {
          case "WOE": return "#1d4ed8";
          case "Glouc": return "#16a34a";
          case "S&M": return "#f59e0b";
          case "Central": return "#dc2626";
          default: return "#6b7280";
        }
      };
      const geojson = {
        type: "FeatureCollection",
        features: demandDocs.map((data) => {
          const lat = parseFloat(data["Latitude"]);
          const lng = parseFloat(data["Longitude"]);
          if (isNaN(lat) || isNaN(lng)) return null;
          const letType = data["Let Type"] || "Unknown";
          const localAuth = data["Local Authority"] || "Unknown";
          const voidType = data["Major or Minor void?"] || "Unknown";
          const locality = data["Locality"] || data["locality"] || "Unknown";
          const rawEndDate = data["Tenancy end date"];
          const tenancyEndDate = rawEndDate;
          return {
            type: "Feature",
            geometry: { type: "Point", coordinates: [lng, lat] },
            properties: {
              address: data["Address of property"] || "",
              postcode: data["Postcode"] || "",
              letType,
              localAuth,
              voidType,
              locality,
              color: getColorForLocality(locality),
              tenancyEndDate,
            }
          };
        }).filter(Boolean),
      };
      map.addSource("historicDemand", {
        type: "geojson",
        data: geojson,
      });
      map.addLayer({
        id: "demand-points",
        type: "circle",
        source: "historicDemand",
        paint: {
          "circle-radius": 5,
          "circle-color": ["get", "color"],
          "circle-opacity": 0.7,
        },
      });
    }

    const monthsSet = new Set();
    const tenancyMonthsSet = new Set();

    const counters = {
      letTypes: {},
      voidTypes: {},
      localities: {},
    };
    const features = [];

    const getColorForLocality = (locality) => {
      switch (locality) {
        case "WOE": return "#1d4ed8";     // blue
        case "Glouc": return "#16a34a";   // green
        case "S&M": return "#f59e0b";     // amber
        case "Central": return "#dc2626"; // red
        default: return "#6b7280";        // gray
      }
    };

    demandDocs.forEach((data) => {
      const lat = parseFloat(data["Latitude"]);
      const lng = parseFloat(data["Longitude"]);
      if (isNaN(lat) || isNaN(lng)) return;
      const letType = data["Let Type"] || "Unknown";
      const localAuth = data["Local Authority"] || "Unknown";
      const voidType = data["Major or Minor void?"] || "Unknown";
      const locality = data["Locality"] || data["locality"] || "Unknown";

      const rawEndDate = data["Tenancy end date"];
      let tenancyEndDate = rawEndDate;

      let tenancyMonthString = null;
      if (tenancyEndDate) {
        const date = new Date(tenancyEndDate);
        if (!isNaN(date)) {
          tenancyMonthString = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
          tenancyMonthsSet.add(tenancyMonthString);
          monthsSet.add(tenancyMonthString);
        }
      }

      counters.letTypes[letType] = (counters.letTypes[letType] || 0) + 1;
      counters.voidTypes[voidType] = (counters.voidTypes[voidType] || 0) + 1;
      counters.localities[locality] = (counters.localities[locality] || 0) + 1;

      const matchesFilters =
        (selectedLetType === "All" || letType === selectedLetType) &&
        (selectedVoidType === "All" || voidType === selectedVoidType) &&
        (selectedLocality === "All" || locality === selectedLocality) &&
        // (selectedTenancyMonth === "All" || tenancyMonthString === selectedTenancyMonth) && // removed as requested
        (selectedMonth === "All" || tenancyMonthString === selectedMonth) &&
        !(selectedLetType === "Relet" && voidType.toLowerCase() === "n/a");

      if (matchesFilters) {
        features.push({
          type: "Feature",
          geometry: {
            type: "Point",
            coordinates: [lng, lat],
          },
          properties: {
            address: data["Address of property"] || "",
            postcode: data["Postcode"] || "",
            letType,
            localAuth,
            voidType,
            locality,
            color: getColorForLocality(locality),
            tenancyEndDate,
          },
        });
      }
    });


    const filteredCounters = {
      letTypes: {},
      voidTypes: {},
      localities: {},
    };

    features.forEach(({ properties }) => {
      const { letType, voidType, locality } = properties;
      filteredCounters.letTypes[letType] = (filteredCounters.letTypes[letType] || 0) + 1;
      filteredCounters.voidTypes[voidType] = (filteredCounters.voidTypes[voidType] || 0) + 1;
      filteredCounters.localities[locality] = (filteredCounters.localities[locality] || 0) + 1;
    });

    setBreakdownStats(filteredCounters);
    setVisibleCount(features.length);

    // Only include months for which there are actual data points in the features array
    const validMonths = Array.from(monthsSet).filter(month => {
      return features.some(f => {
        const date = f.properties.tenancyEndDate;
        if (!date) return false;
        const d = new Date(date);
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, '0');
        return `${y}-${m}` === month;
      });
    }).sort().reverse();
    setAvailableMonths(validMonths);

    const geojson = {
      type: "FeatureCollection",
      features,
    };
    // Add or update the source/layer
    if (map.getSource("historicDemand")) {
      map.getSource("historicDemand").setData(geojson);
    } else {
      map.addSource("historicDemand", {
        type: "geojson",
        data: geojson,
      });
      map.addLayer({
        id: "demand-points",
        type: "circle",
        source: "historicDemand",
        paint: {
          "circle-radius": 5,
          "circle-color": ["get", "color"],
          "circle-opacity": 0.7,
        },
      });
    }
  }, [
    selectedLetType,
    selectedVoidType,
    selectedLocality,
    selectedMonth,
    mapStyle
  ]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 px-6 py-12 font-sans text-gray-800">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="text-center bg-white bg-opacity-70 rounded-xl shadow-sm py-6 px-4 mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">📍 Demand Map (Beta)</h1>
          <p className="text-gray-700 text-sm max-w-xl mx-auto">
            Explore historical void patterns by location, type, and timing to support planning and resourcing.
          </p>
        </header>

        <div className="mb-4">
          <label htmlFor="mapStyle" className="mr-2 font-medium">Map Style:</label>
          <select
            id="mapStyle"
            onChange={(e) => setMapStyle(e.target.value)}
            className="border px-2 py-1 rounded"
            value={mapStyle}
          >
            <option value="mapbox://styles/mapbox/streets-v11">Streets</option>
            <option value="mapbox://styles/mapbox/outdoors-v11">Outdoors</option>
            <option value="mapbox://styles/mapbox/light-v10">Light</option>
            <option value="mapbox://styles/mapbox/satellite-streets-v12">Satellite</option>
          </select>
        </div>

        <div className="text-sm text-gray-700">
          Showing <strong>{visibleCount}</strong> matching properties on the map.
          <ul className="ml-4 mt-1 list-disc text-xs text-gray-600">
            {Object.entries(breakdownStats.letTypes || {}).map(([type, count]) => (
              <li key={`let-${type}`}>Let Type {type}: {count}</li>
            ))}
            {Object.entries(breakdownStats.voidTypes || {}).map(([type, count]) => (
              <li key={`void-${type}`}>Void Type {type}: {count}</li>
            ))}
            {Object.entries(breakdownStats.localities || {}).map(([loc, count]) => (
              <li key={`loc-${loc}`}>Locality {loc}: {count}</li>
            ))}
          </ul>
        </div>

        <div className="mb-4 flex gap-4 flex-wrap">
          <div>
            <label htmlFor="letType" className="mr-2 font-medium">Let Type:</label>
            <select
              id="letType"
              value={selectedLetType}
              onChange={(e) => setSelectedLetType(e.target.value)}
              className="border px-2 py-1 rounded"
            >
              <option value="All">All</option>
              <option value="Relet">Relet</option>
              <option value="New Build">New Build</option>
            </select>
          </div>

          <div>
            <label htmlFor="voidType" className="mr-2 font-medium">Void Type:</label>
            <select
              id="voidType"
              value={selectedVoidType}
              onChange={(e) => setSelectedVoidType(e.target.value)}
              className="border px-2 py-1 rounded"
            >
              <option value="All">All</option>
              <option value="Major">Major</option>
              <option value="Minor">Minor</option>
            </select>
          </div>

          <div>
            <label htmlFor="locality" className="mr-2 font-medium">Locality:</label>
            <select
              id="locality"
              value={selectedLocality}
              onChange={(e) => setSelectedLocality(e.target.value)}
              className="border px-2 py-1 rounded"
            >
              <option value="All">All</option>
              <option value="WOE">WOE</option>
              <option value="Glouc">Glouc</option>
              <option value="S&M">S&amp;M</option>
              <option value="Central">Central</option>
            </select>
          </div>

          <div>
            <label htmlFor="month" className="mr-2 font-medium">Month:</label>
            <select
              id="month"
              value={selectedMonth}
              onChange={(e) => setSelectedMonth(e.target.value)}
              className="border px-2 py-1 rounded"
            >
              <option value="All">All</option>
              {Array.from(new Set(
                demandDataRef.current?.map((data) => {
                  const date = new Date(data["Tenancy end date"]);
                  if (!isNaN(date)) {
                    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                  }
                  return null;
                }).filter(Boolean)
              )).sort().reverse().map(month => (
                <option key={month} value={month}>
                  {new Date(`${month}-01`).toLocaleString('default', { month: 'long', year: 'numeric' })}
                </option>
              ))}
            </select>
          </div>

        </div>

        <div
          ref={mapContainerRef}
          className="w-full h-[80vh] rounded-lg shadow"
        />

        <div className="bg-white mt-8 p-4 rounded shadow text-sm">
          <h2 className="text-lg font-semibold mb-2">📊 Demand Summary (Mar 2024 – Mar 2025)</h2>
          <div className="overflow-x-auto">
            <table className="table-auto w-full text-left text-xs border border-collapse rounded-lg overflow-hidden shadow">
              <thead>
                <tr className="bg-gray-100">
                  <th className="p-2 border">Locality</th>
                  {Array.from({ length: 13 }).map((_, i) => {
                    const d = new Date(2024, 2 + i); // March 2024 to March 2025
                    return (
                      <th key={i} className="p-2 border">
                        {formatMonthYear(d)}
                      </th>
                    );
                  })}
                  {/* Total column header */}
                  <th className="p-2 border font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {["WOE", "Glouc", "S&M", "Central"].map(locality => {
                  // Calculate per-month counts for the locality
                  const monthCounts = Array.from({ length: 13 }).map((_, i) => {
                    const d = new Date(2024, 2 + i);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                    const count = demandDataRef.current?.filter(data => {
                      const l = data["Locality"] || data["locality"];
                      const letType = data["Let Type"] || "";
                      const voidType = data["Major or Minor void?"] || "";
                      const date = new Date(data["Tenancy end date"]);
                      const ym = !isNaN(date) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "";
                      return (
                        l === locality &&
                        ym === key &&
                        letType === "Relet" &&
                        voidType.toLowerCase() !== "n/a"
                      );
                    }).length || 0;
                    return count;
                  });
                  // Calculate total for this locality
                  const totalForLocality = monthCounts.reduce((a, b) => a + b, 0);
                  return (
                    <tr key={locality} className="hover:bg-gray-50 transition-colors">
                      <td className="p-2 border font-semibold sticky left-0 bg-white z-10">{locality}</td>
                      {monthCounts.map((count, idx) => (
                        <td
                          key={idx}
                          className="p-2 border text-center relative group"
                        >
                          {count}
                          <span className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1 px-2 py-1 bg-gray-800 text-white rounded text-xs opacity-0 group-hover:opacity-100 pointer-events-none z-20 transition-opacity duration-200">
                            {`${locality} – ${new Date(2024, 2 + idx).toLocaleString("default", { month: "long", year: "numeric" })}: ${count}`}
                          </span>
                        </td>
                      ))}
                      {/* Total column per locality */}
                      <td className="p-2 border text-center font-semibold bg-gray-50">{totalForLocality}</td>
                    </tr>
                  );
                })}
                <tr className="font-bold bg-gray-50">
                  <td className="p-2 border sticky left-0 bg-gray-50 z-10">Total</td>
                  {Array.from({ length: 13 }).map((_, i) => {
                    const d = new Date(2024, 2 + i);
                    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                    const count = demandDataRef.current?.filter(data => {
                      const letType = data["Let Type"] || "";
                      const voidType = data["Major or Minor void?"] || "";
                      const date = new Date(data["Tenancy end date"]);
                      const ym = !isNaN(date) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "";
                      return (
                        ym === key &&
                        letType === "Relet" &&
                        voidType.toLowerCase() !== "n/a"
                      );
                    }).length || 0;
                    return (
                      <td key={key} className="p-2 border text-center font-semibold bg-gray-50">
                        {count}
                      </td>
                    );
                  })}
                  {/* Total of all months and localities */}
                  <td className="p-2 border text-center font-bold bg-yellow-100">
                    {
                      (() => {
                        // Calculate the grand total
                        const totals = Array.from({ length: 13 }).map((_, i) => {
                          const d = new Date(2024, 2 + i);
                          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
                          const count = demandDataRef.current?.filter(data => {
                            const letType = data["Let Type"] || "";
                            const voidType = data["Major or Minor void?"] || "";
                            const date = new Date(data["Tenancy end date"]);
                            const ym = !isNaN(date) ? `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}` : "";
                            return (
                              ym === key &&
                              letType === "Relet" &&
                              voidType.toLowerCase() !== "n/a"
                            );
                          }).length || 0;
                          return count;
                        });
                        return totals.reduce((a, b) => a + b, 0);
                      })()
                    }
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>


        <div className="bg-white mt-8 p-4 rounded shadow text-sm">
          <h2 className="text-lg font-semibold mb-4">📊 Demand by Locality (Mar 2024 – Mar 2025)</h2>
          <ResponsiveContainer width="100%" height={400}>
            <BarChart
              data={buildScatterData(demandDataRef.current || [], "Locality").data}
              margin={{ top: 20, right: 30, left: 0, bottom: 80 }}
              >
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis
                dataKey="month"
                interval={0}
                angle={-45}
                textAnchor="end"
                height={60}
              />
              <YAxis />
              <Tooltip />
              <Legend verticalAlign="top" />
              {buildScatterData(demandDataRef.current || [], "Locality").uniqueKeys.map((key, index) => (
                <Bar
                  key={key}
                  dataKey={key}
                  stackId="a"
                  fill={["#1d4ed8", "#16a34a", "#f59e0b", "#dc2626"][index] || "#6b7280"}
                />
              ))}
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Live SOR Submissions Map (moved below both graphs) */}
        <div className="mt-12">
          <h2 className="text-xl font-bold mb-2">🛰️ Live SOR Submissions Map</h2>
          <p className="text-sm text-gray-600 mb-4">Showing most recent survey locations with GPS where available.</p>
          {/* Date range and map style controls for live SOR submissions map */}
          <div className="flex flex-wrap items-center gap-4 mb-4 text-sm">
            <div>
              <label className="mr-2 font-medium">Start Date:</label>
              <input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="border px-2 py-1 rounded"
              />
            </div>
            <div>
              <label className="mr-2 font-medium">End Date:</label>
              <input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="border px-2 py-1 rounded"
              />
            </div>
            <button
              onClick={fetchLiveSORs}
              className="bg-blue-600 text-white px-4 py-1.5 rounded hover:bg-blue-700"
            >
              Refresh Map
            </button>
            <div>
              <label htmlFor="liveMapStyle" className="mr-2 font-medium">Map Style:</label>
              <select
                id="liveMapStyle"
                onChange={(e) => setLiveMapStyle(e.target.value)}
                className="border px-2 py-1 rounded"
                value={liveMapStyle}
              >
                <option value="mapbox://styles/mapbox/streets-v11">Streets</option>
                <option value="mapbox://styles/mapbox/outdoors-v11">Outdoors</option>
                <option value="mapbox://styles/mapbox/light-v10">Light</option>
                <option value="mapbox://styles/mapbox/satellite-streets-v12">Satellite</option>
              </select>
            </div>
          </div>
          <div
            ref={liveMapContainerRef}
            className="w-full h-[70vh] rounded-lg shadow"
          />
          {/* Filters for live SOR submissions */}
          <div className="mt-4 flex flex-wrap gap-4 text-sm">
            <div>
              <label className="mr-2 font-medium">Visit Type:</label>
              <select
                value={visitTypeFilter}
                onChange={(e) => setVisitTypeFilter(e.target.value)}
                className="border px-2 py-1 rounded"
              >
                <option value="All">All</option>
                {[...new Set(liveSORs.map(f => f.properties.letType))].filter(Boolean).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mr-2 font-medium">Void Type:</label>
              <select
                value={voidTypeFilter}
                onChange={(e) => setVoidTypeFilter(e.target.value)}
                className="border px-2 py-1 rounded"
              >
                <option value="All">All</option>
                {[...new Set(liveSORs.map(f => f.properties.voidType))].filter(Boolean).map(type => (
                  <option key={type} value={type}>{type}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="mr-2 font-medium">Surveyor:</label>
              <select
                value={surveyorFilter === "All" ? "All" : surveyorFilter.trim().toLowerCase()}
                onChange={(e) => setSurveyorFilter(e.target.value)}
                className="border px-2 py-1 rounded"
              >
                <option value="All">All</option>
                {[...new Map(
                  liveSORs
                    .filter(f => f.properties.surveyor)
                    .map(f => {
                      const raw = f.properties.surveyor;
                      const cleaned = raw.trim();
                      return [cleaned.toLowerCase(), cleaned];
                    })
                ).values()].map(name => (
                  <option key={name} value={name.trim().toLowerCase()}>{name}</option>
                ))}
              </select>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}