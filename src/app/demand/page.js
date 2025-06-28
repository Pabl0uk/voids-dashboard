"use client";

import { useEffect, useRef } from "react";
import mapboxgl from "mapbox-gl";
import { collection, getDocs } from "firebase/firestore";
import { db } from "../../lib/firebase";

mapboxgl.accessToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || "";

export default function DemandMapPage() {
  const mapContainerRef = useRef(null);

  useEffect(() => {
    if (!mapContainerRef.current) return;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: "mapbox://styles/mapbox/streets-v11",
      center: [-1.9, 52.5],
      zoom: 7,
    });


    map.on("load", async () => {
      try {
        const snapshot = await getDocs(collection(db, "historicDemand"));
        const features = [];

        snapshot.forEach((doc) => {
          const data = doc.data();
          const [lat, lng] = data.location || [];

          if (!lat || !lng) return;

          features.push({
            type: "Feature",
            geometry: {
              type: "Point",
              coordinates: [lng, lat],
            },
            properties: {
              address: data["Address of property"] || "",
              postcode: data["Postcode"] || "",
              letType: data["Let Type"] || "",
              visitType: data["GN & HFoP, Supp. or other"] || "Unknown",
            },
          });
        });

        const geojson = {
          type: "FeatureCollection",
          features,
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
            "circle-color": "#1d4ed8",
            "circle-opacity": 0.7,
          },
        });

        map.on("click", "demand-points", (e) => {
          const props = e.features?.[0]?.properties;
          if (!props) return;

          new mapboxgl.Popup()
            .setLngLat(e.lngLat)
            .setHTML(`
              <strong>${props.address}</strong><br/>
              Postcode: ${props.postcode}<br/>
              Let Type: ${props.letType}<br/>
              Visit Type: ${props.visitType}
            `)
            .addTo(map);
        });
      } catch (err) {
        console.error("Failed to load demand data:", err);
      }
    });

    return () => map.remove();
  }, []);

  return (
    <div className="p-6">
      <h1 className="text-3xl font-bold mb-4">📍 Demand Map (Beta)</h1>
      <div
        ref={mapContainerRef}
        className="w-full h-[80vh] rounded-lg shadow"
      />
    </div>
  );
}