const fs = require("fs");
const csv = require("csv-parser");
const admin = require("firebase-admin");
const serviceAccount = require("./serviceAccountKey.json");
const fetch = require('node-fetch');

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});
const db = admin.firestore();

function isValidUKCoords(lat, lng) {
  return lat >= 49 && lat <= 61 && lng >= -8 && lng <= 2;
}

async function getCoordsFromPostcode(postcode) {
  try {
    const response = await fetch(`https://api.postcodes.io/postcodes/${encodeURIComponent(postcode)}`);
    if (!response.ok) return null;
    const data = await response.json();
    if (data.status === 200) {
      return {
        lat: data.result.latitude,
        lng: data.result.longitude,
      };
    }
  } catch (err) {
    console.warn(`Failed to fetch coordinates for ${postcode}:`, err);
  }
  return null;
}

async function parseCSV(filepath) {
  const rows = [];
  return new Promise((resolve, reject) => {
    fs.createReadStream(filepath)
      .pipe(csv())
      .on("data", (row) => rows.push(row))
      .on("end", () => resolve(rows))
      .on("error", reject);
  });
}

async function uploadData() {
  const rawRows = await parseCSV("combined.csv");
  const results = [];

  for (const row of rawRows) {
    let lat = parseFloat(row["Latitude"]);
    let lng = parseFloat(row["Longitude"]);
    const postcode = row["Postcode"];

    if (postcode) {
      const fixed = await getCoordsFromPostcode(postcode);
      if (fixed) {
        lat = fixed.lat;
        lng = fixed.lng;
        row["Latitude"] = lat;
        row["Longitude"] = lng;
        console.log(`✅ Fixed coords for ${postcode}`);
      } else {
        console.warn(`⚠️ Skipping row with invalid coords and no fix for ${postcode}`);
        continue;
      }
    }

    const letType = (row["Let Type"] || "").trim().toLowerCase();
    const majorMinor = (row["Major or Minor void?"] || "").trim().toLowerCase();

    if (letType === "relet" && majorMinor === "n/a") {
      console.warn(`⚠️ Skipping relet with N/A major/minor: ${row["Address of property"]}`);
      continue;
    }

    results.push(row);
  }

  const batch = db.batch();
  results.forEach((record) => {
    const ref = db.collection("historicDemand").doc();
    batch.set(ref, {
      ...record,
      createdAt: new Date().toISOString(),
    });
  });

  await batch.commit();
  console.log(`✅ Uploaded ${results.length} records to Firestore`);
}

uploadData();