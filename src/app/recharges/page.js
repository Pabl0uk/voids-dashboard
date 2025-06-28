/* eslint-disable no-unused-vars */
"use client";

import { useEffect, useState, useMemo } from "react";
import { collection, getDocs } from "firebase/firestore";
import { db } from '../lib/firebase';
import { Bar, Line } from 'react-chartjs-2';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  BarElement,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
} from 'chart.js';
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

ChartJS.register(CategoryScale, LinearScale, BarElement, PointElement, LineElement, Title, Tooltip, Legend);

// Helper to flatten SORs object to a single array of SORs
const getAllSors = sorsObj =>
  Object.values(sorsObj || {}).flatMap(section =>
    Array.isArray(section) ? section : []
  );

export default function RechargeDashboard() {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      const querySnapshot = await getDocs(collection(db, "surveys"));
      const docs = querySnapshot.docs.map(doc => doc.data());
      setData(docs);
      setLoading(false);
    }
    fetchData();
  }, []);

  const [selectedSurveyor, setSelectedSurveyor] = useState("All");
  const [selectedMonth, setSelectedMonth] = useState("All");

  const uniqueSurveyors = useMemo(() => {
    const allSurveyors = data.map(d => d.surveyorName).filter(Boolean);
    return ["All", ...Array.from(new Set(allSurveyors))];
  }, [data]);

  const filteredData = useMemo(() => {
    return data.filter(d => {
      const matchesSurveyor = selectedSurveyor === "All" || d.surveyorName === selectedSurveyor;
      const monthString = new Date(d.submittedAt).toLocaleString('default', { month: 'long', year: 'numeric' });
      const matchesMonth = selectedMonth === "All" || monthString === selectedMonth;
      return matchesSurveyor && matchesMonth;
    });
  }, [data, selectedSurveyor, selectedMonth]);

  const rechargeVoids = filteredData.filter(s => {
    const allSors = getAllSors(s.sors);
    return allSors.some(sor =>
      Number(sor.quantity) > 0 &&
      (
        String(sor.recharge).toLowerCase() === "true" ||
        Number(sor.rechargeTime || 0) > 0 ||
        Number(sor.rechargeCost || 0) > 0
      )
    );
  });

  const totalRechargeCost = rechargeVoids.reduce((acc, s) => {
    return acc + Number(s?.totals?.rechargeCost || 0);
  }, 0);

  const totalRechargeTime = rechargeVoids.reduce((acc, s) => {
    return acc + Number(s?.totals?.rechargeDaysDecimal || 0) * 60;
  }, 0);

  // Monthly recharge trend calculation
  const monthlyRechargeTotals = rechargeVoids.reduce((acc, s) => {
    const date = new Date(s.submittedAt);
    const month = date.toLocaleString('default', { month: 'short', year: 'numeric' });
    acc[month] = (acc[month] || 0) + Number(s?.totals?.rechargeCost || 0);
    return acc;
  }, {});

  const chartData = {
    labels: Object.keys(monthlyRechargeTotals),
    datasets: [
      {
        label: 'Recharge Cost (£)',
        data: Object.values(monthlyRechargeTotals),
        backgroundColor: '#facc15',
        borderColor: '#eab308',
        borderWidth: 1,
      },
    ],
  };

  const chartOptions = {
    responsive: true,
    plugins: {
      legend: { position: 'top' },
      title: { display: true, text: 'Recharge Cost by Month' },
    },
  };

  const rechargeTrendlineData = {
    labels: Object.keys(monthlyRechargeTotals),
    datasets: [
      {
        label: 'Trendline Recharge Cost (£)',
        data: Object.values(monthlyRechargeTotals),
        fill: false,
        borderColor: '#3b82f6',
        backgroundColor: '#93c5fd',
        tension: 0.3,
      },
    ],
  };

  const handleExportToPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(14);
    doc.text("Recharge Detail Table", 14, 20);

    const tableColumn = ["Property Address", "Surveyor", "Submitted", "Recharge Cost (£)", "Recharge Time (mins)", "Recharge Items"];
    const tableRows = rechargeVoids.map((s) => {
      const allSors = getAllSors(s.sors);
      const rechargeDescriptions = allSors
        .filter(sor => Number(sor.quantity) > 0 && String(sor.recharge).toLowerCase() === "true")
        .map(sor => sor.description)
        .filter(Boolean)
        .slice(0, 3)
        .join(", ");
      return [
        s.propertyAddress || "N/A",
        s.surveyorName || "N/A",
        new Date(s.submittedAt).toLocaleDateString(),
        Number(s?.totals?.rechargeCost || 0).toFixed(2),
        Number(s?.totals?.rechargeDaysDecimal || 0) * 60,
        rechargeDescriptions || "N/A"
      ];
    });

    autoTable(doc, {
      head: [tableColumn],
      body: tableRows,
      startY: 30,
      styles: { fontSize: 10 },
      headStyles: { fillColor: [248, 217, 102] }
    });

    doc.save("recharge_report.pdf");
  };

  return (
    <div style={{ padding: '2rem', backgroundColor: '#f9fafb', color: '#111827', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '1rem' }}>💰 Recharge Dashboard</h1>
      <div style={{ marginBottom: '1.5rem' }}>
        <button
          onClick={handleExportToPDF}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#facc15',
            border: 'none',
            borderRadius: '4px',
            color: '#111827',
            fontWeight: 'bold',
            cursor: 'pointer',
            boxShadow: '0 1px 2px rgba(0,0,0,0.1)'
          }}
        >
          📤 Export Recharge Data
        </button>
      </div>
      <p className="text-gray-700 mb-6">
        Track voids with tenant damage, most common recharge types, and cost/time impact.
      </p>

      <div style={{ marginBottom: '1.5rem' }}>
        <label htmlFor="surveyorSelect" style={{ marginRight: '0.5rem' }}>Filter by Surveyor:</label>
        <select
          id="surveyorSelect"
          value={selectedSurveyor}
          onChange={e => setSelectedSurveyor(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
        >
          {uniqueSurveyors.map(surveyor => (
            <option key={surveyor} value={surveyor}>{surveyor}</option>
          ))}
        </select>
      </div>

      <div style={{ marginBottom: '1.5rem' }}>
        <label htmlFor="monthSelect" style={{ marginRight: '0.5rem' }}>Filter by Month:</label>
        <select
          id="monthSelect"
          value={selectedMonth}
          onChange={e => setSelectedMonth(e.target.value)}
          style={{ padding: '0.5rem', borderRadius: '4px', border: '1px solid #ccc' }}
        >
          <option value="All">All</option>
          {Array.from(new Set(data.map(d => {
            const date = new Date(d.submittedAt);
            return date.toLocaleString('default', { month: 'long', year: 'numeric' });
          }))).map(month => (
            <option key={month} value={month}>{month}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', justifyContent: 'space-between', marginBottom: '2rem' }}>
            <div style={{
              background: '#fefce8',
              color: '#854d0e',
              padding: '1rem',
              borderRadius: '0.5rem',
              border: '1px solid #fef3c7',
              flex: '1 1 200px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3>Total Submissions</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{filteredData.length}</p>
            </div>
            <div style={{
              background: '#fefce8',
              color: '#854d0e',
              padding: '1rem',
              borderRadius: '0.5rem',
              border: '1px solid #fef3c7',
              flex: '1 1 200px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3>Voids with Recharge</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{rechargeVoids.length}</p>
            </div>
            <div style={{
              background: '#fefce8',
              color: '#854d0e',
              padding: '1rem',
              borderRadius: '0.5rem',
              border: '1px solid #fef3c7',
              flex: '1 1 200px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3>Recharge %</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                {filteredData.length > 0 ? ((rechargeVoids.length / filteredData.length) * 100).toFixed(1) + "%" : "N/A"}
              </p>
            </div>
            {/* New With Recharge % box inserted here */}
            <div style={{
              background: '#fefce8',
              color: '#854d0e',
              padding: '1rem',
              borderRadius: '0.5rem',
              border: '1px solid #fef3c7',
              flex: '1 1 200px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3>With Recharge %</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                {filteredData.length > 0
                  ? ((rechargeVoids.length / filteredData.length) * 100).toFixed(1) + "%"
                  : "N/A"}
              </p>
            </div>
            {/* Inserted No Recharge % box here */}
            <div style={{
              background: '#fefce8',
              color: '#854d0e',
              padding: '1rem',
              borderRadius: '0.5rem',
              border: '1px solid #fef3c7',
              flex: '1 1 200px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3>No Recharge %</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                {filteredData.length > 0
                  ? (((filteredData.length - rechargeVoids.length) / filteredData.length) * 100).toFixed(1) + "%"
                  : "N/A"}
              </p>
            </div>
            {/* End No Recharge % box */}
            <div style={{
              background: '#fefce8',
              color: '#854d0e',
              padding: '1rem',
              borderRadius: '0.5rem',
              border: '1px solid #fef3c7',
              flex: '1 1 200px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3>Total Recharge Cost (£)</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{totalRechargeCost.toFixed(2)}</p>
            </div>
            <div style={{
              background: '#fefce8',
              color: '#854d0e',
              padding: '1rem',
              borderRadius: '0.5rem',
              border: '1px solid #fef3c7',
              flex: '1 1 200px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3>Total Recharge Time (mins)</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{totalRechargeTime}</p>
            </div>
            {/* Average Recharge Cost (£) box moved inside this container */}
            <div style={{
              background: '#fefce8',
              color: '#854d0e',
              padding: '1rem',
              borderRadius: '0.5rem',
              border: '1px solid #fef3c7',
              flex: '1 1 200px',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)'
            }}>
              <h3>Average Recharge Cost (£)</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                {rechargeVoids.length > 0 ? (totalRechargeCost / rechargeVoids.length).toFixed(2) : 'N/A'}
              </p>
            </div>
          </div>

          <div style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>📊 Recharge Breakdown by Surveyor</h2>
            <ul style={{ listStyle: 'none', paddingLeft: 0, lineHeight: '1.75' }}>
              {Object.entries(
                rechargeVoids.reduce((acc, s) => {
                  const name = s.surveyorName || "Unknown";
                  acc[name] = (acc[name] || 0) + 1;
                  return acc;
                }, {})
              ).sort((a, b) => b[1] - a[1]).map(([name, count]) => (
                <li key={name}><strong>{name}</strong>: {count} recharges</li>
              ))}
            </ul>
          </div>

          <div style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>🧾 Recharge Breakdown by Type</h2>
            <ul style={{ listStyle: 'none', paddingLeft: 0, lineHeight: '1.75' }}>
              {Object.entries(
                rechargeVoids.flatMap(s => getAllSors(s.sors))
                  .filter(sor => Number(sor.quantity) > 0 && String(sor.recharge).toLowerCase() === "true")
                  .reduce((acc, sor) => {
                    const key = sor.description || "Unknown";
                    acc[key] = (acc[key] || 0) + Number(sor.quantity || 1);
                    return acc;
                  }, {})
              ).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([type, count]) => (
                <li key={type}><strong>{type}</strong>: {count}</li>
              ))}
            </ul>
          </div>

          <div style={{
            marginTop: '2rem',
            padding: '1.5rem',
            backgroundColor: '#ffffff',
            border: '1px solid #e5e7eb',
            borderRadius: '0.5rem',
            boxShadow: '0 1px 2px rgba(0,0,0,0.05)'
          }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>🔢 Most Common Recharge SORs</h2>
            <ul style={{ listStyle: 'none', paddingLeft: 0, lineHeight: '1.75' }}>
              {Object.entries(
                rechargeVoids.flatMap(s => getAllSors(s.sors))
                  .filter(sor => Number(sor.quantity) > 0 && String(sor.recharge).toLowerCase() === "true")
                  .reduce((acc, sor) => {
                    const key = `${sor.code} - ${sor.description}`;
                    acc[key] = (acc[key] || 0) + Number(sor.quantity || 1);
                    return acc;
                  }, {})
              ).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([desc, count]) => (
                <li key={desc}>
                  <strong>{desc}</strong>: {count}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
      <div style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>🧮 Average Recharge Time (mins)</h2>
        <p style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#854d0e' }}>
          {rechargeVoids.length > 0 ? (totalRechargeTime / rechargeVoids.length).toFixed(1) : 'N/A'}
        </p>
      </div>
      <div style={{ marginTop: '2rem', backgroundColor: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>📈 Monthly Recharge Trend</h2>
        <Bar data={chartData} options={chartOptions} />
      </div>
      <div style={{ marginTop: '2rem', backgroundColor: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>📋 Recharge Detail Table</h2>
        <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'scroll' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left', padding: '0.5rem' }}>Property Address</th>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left', padding: '0.5rem' }}>Surveyor</th>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left', padding: '0.5rem' }}>Submitted</th>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left', padding: '0.5rem' }}>Recharge Cost (£)</th>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left', padding: '0.5rem' }}>Recharge Time (mins)</th>
                <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left', padding: '0.5rem' }}>Recharge Items</th>
              </tr>
            </thead>
            <tbody>
              {rechargeVoids.map((s, idx) => {
                const allSors = getAllSors(s.sors);
                const rechargeDescriptions = allSors
                  .filter(sor => Number(sor.quantity) > 0 && String(sor.recharge).toLowerCase() === "true")
                  .map(sor => sor.description)
                  .filter(Boolean)
                  .slice(0, 3)
                  .join(", ");
                return (
                  <tr key={idx}>
                    <td style={{ borderBottom: '1px solid #eee', padding: '0.5rem' }}>{s.propertyAddress || "N/A"}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: '0.5rem' }}>{s.surveyorName || "N/A"}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: '0.5rem' }}>{new Date(s.submittedAt).toLocaleDateString()}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: '0.5rem' }}>{Number(s?.totals?.rechargeCost || 0).toFixed(2)}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: '0.5rem' }}>{Number(s?.totals?.rechargeDaysDecimal || 0) * 60}</td>
                    <td style={{ borderBottom: '1px solid #eee', padding: '0.5rem' }}>{rechargeDescriptions || "N/A"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: '2rem', backgroundColor: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>📅 Voids by Month</h2>
        <Bar
          data={{
            labels: Object.keys(monthlyRechargeTotals),
            datasets: [
              {
                label: 'Voids with Recharge',
                data: Object.values(monthlyRechargeTotals).map(
                  (val, idx) => rechargeVoids.filter(s => {
                    const date = new Date(s.submittedAt);
                    const month = date.toLocaleString('default', { month: 'short', year: 'numeric' });
                    return month === Object.keys(monthlyRechargeTotals)[idx];
                  }).length
                ),
                backgroundColor: '#a3e635',
                borderColor: '#84cc16',
                borderWidth: 1,
              },
            ],
          }}
          options={{
            responsive: true,
            plugins: {
              legend: { position: 'top' },
              title: { display: true, text: 'Voids with Recharge by Month' },
            },
          }}
        />
      </div>
      <div style={{ marginTop: '2rem', backgroundColor: '#fff', padding: '1rem', borderRadius: '8px', boxShadow: '0 1px 2px rgba(0,0,0,0.1)' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>📉 Recharge Cost Trend</h2>
        <Line data={rechargeTrendlineData} />
      </div>
    </div>
  );
}