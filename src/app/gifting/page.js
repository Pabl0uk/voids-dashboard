'use client';

import React, { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Pie } from 'react-chartjs-2';
import 'chart.js/auto';

const GiftingDashboard = () => {
  const [giftedItems, setGiftedItems] = useState([]);
  const [filteredItems, setFilteredItems] = useState([]);
  const [nonGiftedItems, setNonGiftedItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [surveyorFilter, setSurveyorFilter] = useState('All');
  const [giftTypeFilter, setGiftTypeFilter] = useState('All');
  const [totalSurveys, setTotalSurveys] = useState(0);

  useEffect(() => {
    const fetchGiftingData = async () => {
      const querySnapshot = await getDocs(collection(db, 'surveys'));
      const data = [];
      let totalSurveys = 0;

      querySnapshot.forEach((doc) => {
        totalSurveys++;
        const giftedText = doc.data().giftedItemsNotes?.toLowerCase() || '';
        if (giftedText) {
          data.push({
            id: doc.id,
            giftedItemsNotes: giftedText,
            address: doc.data().propertyAddress || 'N/A',
            surveyorName: doc.data().surveyorName || 'Unknown',
          });
        }
      });

      setGiftedItems(data);
      setTotalSurveys(totalSurveys);
      setLoading(false);
      setFilteredItems(data); // initial unfiltered list
    };

    fetchGiftingData();
  }, []);

  useEffect(() => {
    let result = giftedItems;
    if (surveyorFilter !== 'All') {
      result = result.filter(item => item.surveyorName === surveyorFilter);
    }
    if (giftTypeFilter !== 'All') {
      result = result.filter(item => {
        const note = item.giftedItemsNotes;
        const flooringKeywords = ['carpet', 'vinyl', 'laminate', 'floor', 'flooring'];
        const windowCoveringKeywords = ['curtain', 'blind'];
        const allKeywords = [...flooringKeywords, ...windowCoveringKeywords, 'shed'];
        if (giftTypeFilter === 'flooring') {
          return flooringKeywords.some(k => note.includes(k));
        } else if (giftTypeFilter === 'windowCoverings') {
          return windowCoveringKeywords.some(k => note.includes(k));
        } else if (giftTypeFilter === 'other') {
          return allKeywords.every(k => !note.includes(k));
        }
        return note.includes(giftTypeFilter);
      });
    }
    setFilteredItems(result);

    // Calculate nonGiftedItems as the complement set from giftedItems filtered by surveyorFilter and giftTypeFilter
    // We consider nonGiftedItems as those giftedItems that do not match the giftTypeFilter keywords
    const flooringKeywords = ['carpet', 'vinyl', 'laminate', 'floor', 'flooring'];
    const windowCoveringKeywords = ['curtain', 'blind'];
    const allKeywords = [...flooringKeywords, ...windowCoveringKeywords, 'shed'];

    let nonGiftedResult = giftedItems;
    if (surveyorFilter !== 'All') {
      nonGiftedResult = nonGiftedResult.filter(item => item.surveyorName === surveyorFilter);
    }
    if (giftTypeFilter !== 'All') {
      nonGiftedResult = nonGiftedResult.filter(item => {
        const note = item.giftedItemsNotes;
        if (giftTypeFilter === 'flooring') {
          return !flooringKeywords.some(k => note.includes(k));
        } else if (giftTypeFilter === 'windowCoverings') {
          return !windowCoveringKeywords.some(k => note.includes(k));
        } else if (giftTypeFilter === 'other') {
          return !allKeywords.every(k => !note.includes(k));
        }
        return !note.includes(giftTypeFilter);
      });
    } else {
      nonGiftedResult = [];
    }
    setNonGiftedItems(nonGiftedResult);
  }, [surveyorFilter, giftTypeFilter, giftedItems]);

  const keywords = [
    'flooring',
    'window Coverings',
    'shed'
  ];

  const categorizedCounts = keywords.reduce((acc, keyword) => {
    acc[keyword] = 0;
    return acc;
  }, { other: 0 });

  filteredItems.forEach(item => {
    const note = item.giftedItemsNotes;
    let matched = false;

    // Combine multiple keywords into 'flooring'
    if (['carpet', 'vinyl', 'laminate', 'floor'].some(k => note.includes(k))) {
      categorizedCounts['flooring']++;
      matched = true;
    }

    if (['curtain', 'blind'].some(k => note.includes(k))) {
      categorizedCounts['windowCoverings']++;
      matched = true;
    }

    if (note.includes('shed')) {
      categorizedCounts['shed']++;
      matched = true;
    }

    if (!matched) {
      categorizedCounts.other++;
    }
  });

  const surveyors = [...new Set(giftedItems.map(item => item.surveyorName))];

  const handleSurveyorChange = (e) => {
    const selected = e.target.value;
    setSurveyorFilter(selected);
  };

  // Chart data for gifted categories or gifted vs not gifted based on giftTypeFilter
  let chartData;
  if (giftTypeFilter === 'All') {
    chartData = {
      labels: Object.keys(categorizedCounts).map(k => k.charAt(0).toUpperCase() + k.slice(1)),
      datasets: [
        {
          data: Object.values(categorizedCounts),
          backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#14b8a6', '#f472b6', '#9ca3af'],
        },
      ],
    };
  } else {
    chartData = {
      labels: ['Gifted', 'Not Gifted'],
      datasets: [
        {
          data: [filteredItems.length, nonGiftedItems.length],
          backgroundColor: ['#3b82f6', '#ef4444'],
        },
      ],
    };
  }

  const chartOptions = {
    plugins: {
      tooltip: {
        callbacks: {
          label: function(context) {
            const label = context.label || '';
            const value = context.parsed || 0;
            const total = context.dataset.data.reduce((a,b) => a + b, 0);
            const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : '0';
            return `${label}: ${value} (${percentage}%)`;
          }
        }
      }
    },
    maintainAspectRatio: false,
  };

  const exportToCSV = () => {
    const headers = ['Address', 'Surveyor', 'Gifted Items Notes'];
    const rows = filteredItems.map(item => [
      `"${item.address.replace(/"/g, '""')}"`,
      `"${item.surveyorName.replace(/"/g, '""')}"`,
      `"${item.giftedItemsNotes.replace(/"/g, '""')}"`
    ]);
    let csvContent = headers.join(',') + '\n' + rows.map(r => r.join(',')).join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'gifted_items.csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div style={{ padding: '2rem', backgroundColor: '#f9fafb', color: '#111827', minHeight: '100vh', fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '1rem' }}>🎁 Gifting Dashboard</h1>

      {loading ? (
        <p>Loading...</p>
      ) : (
        <>
          <div style={{ margin: '1rem 0' }}>
            <label>Filter by Surveyor: </label>
            <select value={surveyorFilter} onChange={handleSurveyorChange}>
              <option value="All">All</option>
              {surveyors.map((s) => (
                <option key={s} value={s}>{s}</option>
              ))}
            </select>
          </div>

          <div style={{ margin: '1rem 0' }}>
            <label>Filter by Gift Type: </label>
            <select value={giftTypeFilter} onChange={(e) => setGiftTypeFilter(e.target.value)}>
              <option value="All">All</option>
              {keywords.concat('other').map(k => (
                <option key={k} value={k}>{k.charAt(0).toUpperCase() + k.slice(1)}</option>
              ))}
            </select>
          </div>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '2rem' }}>
            {keywords.concat('other').map((k) => (
              <div key={k} style={{
                background: '#ffffff',
                color: '#111827',
                boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
                padding: '1rem',
                borderRadius: '0.5rem',
                flex: '1 1 200px',
                border: '1px solid #e5e7eb',
              }}>
                <h3 style={{ margin: 0 }}>{k.charAt(0).toUpperCase() + k.slice(1)}</h3>
                <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{categorizedCounts[k]}</p>
              </div>
            ))}
            <div style={{
              background: '#ffffff',
              color: '#111827',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
              padding: '1rem',
              borderRadius: '0.5rem',
              flex: '1 1 200px',
              border: '1px solid #e5e7eb',
            }}>
              <h3 style={{ margin: 0 }}>Total Gifted</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>{filteredItems.length}</p>
            </div>
            <div style={{
              background: '#ffffff',
              color: '#111827',
              boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)',
              padding: '1rem',
              borderRadius: '0.5rem',
              flex: '1 1 200px',
              border: '1px solid #e5e7eb',
            }}>
              <h3 style={{ margin: 0 }}>Gifted %</h3>
              <p style={{ fontSize: '1.2rem', fontWeight: 'bold' }}>
                {totalSurveys > 0 ? ((filteredItems.length / totalSurveys) * 100).toFixed(1) + '%' : 'N/A'}
              </p>
            </div>
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '2rem', marginBottom: '2rem' }}>
            <div style={{ flex: '1 1 300px', minWidth: 300, maxWidth: 500, height: 400, border: '1px solid #e5e7eb', backgroundColor: '#ffffff', color: '#111827', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)', padding: '1rem' }}>
              <Pie data={chartData} options={chartOptions} />
            </div>

            <div style={{ flex: '2 1 600px', minWidth: 300, border: '1px solid #e5e7eb', backgroundColor: '#ffffff', color: '#111827', borderRadius: '0.5rem', boxShadow: '0 1px 3px rgba(0, 0, 0, 0.1)', padding: '1rem' }}>
              <div style={{ marginBottom: '1rem' }}>
                <button onClick={exportToCSV} style={{
                  backgroundColor: '#2563eb',
                  color: 'white',
                  border: 'none',
                  padding: '0.5rem 1rem',
                  borderRadius: '0.375rem',
                  cursor: 'pointer'
                }}>
                  Export Filtered Items to CSV
                </button>
              </div>

              <div style={{
                backgroundColor: '#e0f2fe',
                border: '1px solid #38bdf8',
                padding: '1rem',
                borderRadius: '0.5rem',
                marginBottom: '1rem',
                color: '#075985'
              }}>
                <strong>Note:</strong> The "Other" category includes anything outside the predefined keywords. Keyword groups may be configurable in future updates.
              </div>

              <h2>Gifted Item Notes</h2>
              <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>
                      <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Address</th>
                      <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Surveyor</th>
                      <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredItems.map((item) => (
                      <tr key={item.id}>
                        <td style={{ padding: '0.5rem 0' }}>{item.address}</td>
                        <td style={{ padding: '0.5rem 0' }}>{item.surveyorName}</td>
                        <td style={{ padding: '0.5rem 0' }}>{item.giftedItemsNotes}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {giftTypeFilter !== 'All' && (
                <>
                  <h2 style={{ marginTop: '2rem' }}>Non-Gifted Entries</h2>
                  <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                      <thead>
                        <tr>
                          <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Address</th>
                          <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Surveyor</th>
                          <th style={{ borderBottom: '1px solid #ccc', textAlign: 'left' }}>Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nonGiftedItems.map((item) => (
                          <tr key={item.id}>
                            <td style={{ padding: '0.5rem 0' }}>{item.address}</td>
                            <td style={{ padding: '0.5rem 0' }}>{item.surveyorName}</td>
                            <td style={{ padding: '0.5rem 0' }}>{item.giftedItemsNotes}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
};

export default GiftingDashboard;
