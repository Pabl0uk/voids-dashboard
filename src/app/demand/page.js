"use client";

import 'mapbox-gl/dist/mapbox-gl.css';

import { useEffect, useRef, useState } from "react";
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
import { collection, getDocs, query, limit } from "firebase/firestore";
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

  // Initialize the map ONCE
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapRef.current) return;

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

    map.on("style.load", () => {
      map.addSource('mapbox-dem', {
        type: 'raster-dem',
        url: 'mapbox://mapbox.terrain-rgb',
        tileSize: 512,
        maxzoom: 14
      });

      map.setTerrain({ source: 'mapbox-dem', exaggeration: 1.5 });

      // Add 3D buildings layer
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
    });

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

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, [mapStyle, mapContainerRef]);

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
                        {d.toLocaleString("default", { month: "short", year: "2-digit" })}
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
      </div>
    </main>
  );
}