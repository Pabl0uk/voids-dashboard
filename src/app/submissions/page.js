'use client';

import { useEffect, useState, useMemo, useRef } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { Chart, BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend } from 'chart.js';
import jsPDF from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';

Chart.register(BarController, BarElement, CategoryScale, LinearScale, Tooltip, Legend);

export default function SubmissionsPage() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [voidTypeFilter, setVoidTypeFilter] = useState("");
  const [rechargeFilter, setRechargeFilter] = useState('');
  const [giftedFilter, setGiftedFilter] = useState('');
  const [visitTypeFilter, setVisitTypeFilter] = useState('');
  const chartRef = useRef(null);
  const chartInstanceRef = useRef(null);

  useEffect(() => {
    async function fetchSubmissions() {
      try {
        const querySnapshot = await getDocs(collection(db, 'surveys'));
        const data = querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        setSubmissions(data);
      } catch (error) {
        console.error('Error fetching submissions:', error);
      } finally {
        setLoading(false);
      }
    }

    fetchSubmissions();
  }, []);

  const availableMonths = useMemo(() => {
    const months = new Set();
    submissions.forEach(sub => {
      if (sub.submittedAt) {
        const date = new Date(sub.submittedAt);
        months.add(`${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`);
      }
    });
    return Array.from(months).sort().reverse();
  }, [submissions]);

  const filteredSubmissions = useMemo(() => {
    return submissions.filter(sub => {
      if (monthFilter) {
        if (!sub.submittedAt) return false;
        const date = new Date(sub.submittedAt);
        const submissionMonth = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        if (submissionMonth !== monthFilter) return false;
      }
      if (voidTypeFilter && sub.voidType !== voidTypeFilter) return false;
      if (filterText && (sub.surveyorName || 'Unknown') !== filterText) return false;
      // Recharge filter
      const hasRecharge = Object.values(sub.sors || {}).some(section =>
        (section || []).some(item => item.recharge)
      );
      if (rechargeFilter === 'yes' && !hasRecharge) return false;
      if (rechargeFilter === 'no' && hasRecharge) return false;
      // Gifted filter
      const hasGifted = !!(sub.giftedItemsNotes && sub.giftedItemsNotes.trim() !== '');
      if (giftedFilter === 'yes' && !hasGifted) return false;
      if (giftedFilter === 'no' && hasGifted) return false;
      // Visit Type filter
      if (visitTypeFilter) {
        const visitTypes = sub.visitTypes || {};
        if (!visitTypes[visitTypeFilter]) return false;
      }
      return true;
    });
  }, [submissions, monthFilter, voidTypeFilter, filterText, rechargeFilter, giftedFilter, visitTypeFilter]);

  // Aggregate average cost per month for chart
  const avgCostPerMonth = useMemo(() => {
    const monthData = {};
    filteredSubmissions.forEach(sub => {
      if (!sub.submittedAt) return;
      const date = new Date(sub.submittedAt);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      if (!monthData[monthKey]) monthData[monthKey] = { totalCost: 0, count: 0 };
      monthData[monthKey].totalCost += parseFloat(sub.totals?.cost || 0);
      monthData[monthKey].count += 1;
    });
    const sortedMonths = Object.keys(monthData).sort();
    return sortedMonths.map(month => ({
      month,
      avgCost: monthData[month].count > 0 ? monthData[month].totalCost / monthData[month].count : 0
    }));
  }, [filteredSubmissions]);

  useEffect(() => {
    if (!chartRef.current) return;

    if (chartInstanceRef.current) {
      chartInstanceRef.current.destroy();
    }

    const labels = avgCostPerMonth.map(d => {
      const [year, month] = d.month.split('-');
      return new Date(year, parseInt(month) - 1).toLocaleString('default', { month: 'short', year: 'numeric' });
    });
    const data = avgCostPerMonth.map(d => d.avgCost);

    chartInstanceRef.current = new Chart(chartRef.current, {
      type: 'bar',
      data: {
        labels,
        datasets: [
          {
            label: 'Average Cost (£)',
            data,
            backgroundColor: '#fbbf24', // amber-400
          }
        ]
      },
      options: {
        responsive: true,
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: context => `£${context.parsed.y.toFixed(2)}`
            }
          },
          // Add onClick for drill-down
          onClick: (e, elements) => {
            if (elements.length > 0) {
              const index = elements[0].index;
              const label = labels[index];
              const parsedDate = new Date(label);
              const year = parsedDate.getFullYear();
              const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
              setMonthFilter(`${year}-${month}`);
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            ticks: {
              callback: val => `£${val}`
            }
          }
        }
      }
    });
  }, [avgCostPerMonth]);

  if (loading) {
    return <p className="text-center mt-8">Loading submissions...</p>;
  }

  if (filteredSubmissions.length === 0) {
    return (
      <div className="text-center mt-12">
        <p className="text-lg font-semibold text-gray-700">No submissions match your filters.</p>
        <p className="text-sm text-gray-500">Try resetting the filters to see more results.</p>
      </div>
    );
  }

  const totalSubmissions = filteredSubmissions.length;
  const majorCount = filteredSubmissions.filter(s => s.voidType === 'Major').length;
  const minorCount = filteredSubmissions.filter(s => s.voidType === 'Minor').length;
  const rechargeCount = filteredSubmissions.filter(sub =>
    Object.values(sub.sors || {}).some(section =>
      (section || []).some(item => item.recharge)
    )
  ).length;
  const totalCost = filteredSubmissions.reduce((sum, sub) => sum + parseFloat(sub.totals?.cost || 0), 0);
  const averageCost = totalSubmissions > 0 ? totalCost / totalSubmissions : 0;
  const highCostCount = filteredSubmissions.filter(sub => parseFloat(sub.totals?.cost || 0) >= 7500).length;

  // Additional summary boxes
  const giftedCount = filteredSubmissions.filter(sub => sub.giftedItemsNotes && sub.giftedItemsNotes.trim() !== '').length;
  const giftedPercent = totalSubmissions > 0 ? (giftedCount / totalSubmissions) * 100 : 0;
  const smvData = filteredSubmissions.filter(sub => typeof sub.totals?.smv === 'number');
  const avgSmv = smvData.length > 0 ? smvData.reduce((sum, sub) => sum + sub.totals.smv, 0) / smvData.length : 0;

  // Export handlers
  function exportToExcel() {
    const wsData = [
      [
        'Filters Applied:',
        `Surveyor: ${filterText || 'All'}`,
        `Month: ${monthFilter || 'All'}`,
        `Void Type: ${voidTypeFilter || 'All'}`,
        `Recharge: ${rechargeFilter ? (rechargeFilter === 'yes' ? 'Yes' : rechargeFilter === 'no' ? 'No' : 'All') : 'All'}`,
        `Gifted: ${giftedFilter ? (giftedFilter === 'yes' ? 'Yes' : giftedFilter === 'no' ? 'No' : 'All') : 'All'}`
      ],
      [''],
      ['Surveyor', 'Property', 'Void Type', 'Total Cost (£)', 'Submitted', 'Gifted Items Notes', 'Visit Types'],
      ...filteredSubmissions.map(sub => [
        sub.surveyorName || 'Unknown',
        sub.propertyAddress || 'N/A',
        sub.voidType || 'N/A',
        sub.totals?.cost ? Number(sub.totals.cost).toFixed(2) : 'N/A',
        sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : 'N/A',
        sub.giftedItemsNotes || '',
        sub.visitTypes ? Object.entries(sub.visitTypes).map(([type, count]) => `${type}: ${count}`).join(', ') : ''
      ])
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Submissions');
    XLSX.writeFile(wb, 'submissions.xlsx');
  }

  function exportToPDF() {
    const doc = new jsPDF();
    doc.text('SOR Submissions', 14, 16);
    const tableColumn = ['Surveyor', 'Property', 'Void Type', 'Total Cost (£)', 'Submitted', 'Gifted Items Notes', 'Visit Types'];
    const tableRows = [
      [
        'Filters Applied:',
        `Surveyor: ${filterText || 'All'}`,
        `Month: ${monthFilter || 'All'}`,
        `Void Type: ${voidTypeFilter || 'All'}`,
        `Recharge: ${rechargeFilter ? (rechargeFilter === 'yes' ? 'Yes' : rechargeFilter === 'no' ? 'No' : 'All') : 'All'}`,
        `Gifted: ${giftedFilter ? (giftedFilter === 'yes' ? 'Yes' : giftedFilter === 'no' ? 'No' : 'All') : 'All'}`
      ],
      [''],
      ...filteredSubmissions.map(sub => [
        sub.surveyorName || 'Unknown',
        sub.propertyAddress || 'N/A',
        sub.voidType || 'N/A',
        sub.totals?.cost ? Number(sub.totals.cost).toFixed(2) : 'N/A',
        sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : 'N/A',
        sub.giftedItemsNotes || '',
        sub.visitTypes ? Object.entries(sub.visitTypes).map(([type, count]) => `${type}: ${count}`).join(', ') : ''
      ])
    ];
    doc.autoTable({
      head: [tableColumn],
      body: tableRows,
      startY: 20,
      styles: { fontSize: 8 },
      headStyles: { fillColor: [251, 191, 36] }, // amber-400
    });
    doc.save('submissions.pdf');
  }

  return (
    <div style={{ padding: '2rem', backgroundColor: '#f9fafb', color: '#111827', minHeight: '100vh', fontFamily: 'system-ui' }}>
      <div className="mb-2">
        <div className="text-4xl font-bold flex items-center mb-4">
          📋 SOR Submissions Dashboard
        </div>
        <div className="flex flex-wrap gap-2 mb-6">
          <select
            value={filterText}
            onChange={(e) => setFilterText(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1"
          >
            <option value="">All Surveyors</option>
            {Array.from(new Set(filteredSubmissions.map(s => s.surveyorName || 'Unknown')))
              .sort()
              .map(name => (
                <option key={name} value={name}>{name}</option>
              ))}
          </select>
          <select
            value={monthFilter}
            onChange={(e) => setMonthFilter(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1"
          >
            <option value="">All Months</option>
            {availableMonths.map(month => (
              <option key={month} value={month}>
                {new Date(`${month}-01`).toLocaleString('default', { month: 'long', year: 'numeric' })}
              </option>
            ))}
          </select>
          <select
            value={voidTypeFilter}
            onChange={(e) => setVoidTypeFilter(e.target.value)}
            className="border border-gray-300 rounded px-2 py-1"
          >
            <option value="">All Void Types</option>
            <option value="Major">Major</option>
            <option value="Minor">Minor</option>
          </select>
          <button
            onClick={() => {
              setFilterText('');
              setMonthFilter('');
              setVoidTypeFilter('');
              setRechargeFilter('');
              setGiftedFilter('');
              setVisitTypeFilter('');
            }}
            className="text-sm text-blue-600 underline"
          >
            Reset Filters
          </button>
        </div>
        {/* New filter bar group */}
        <div className="flex flex-wrap gap-2 mb-6">
          <label className="flex items-center gap-1 text-sm">
            Recharge present:
            <select
              value={rechargeFilter}
              onChange={e => setRechargeFilter(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1"
            >
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-sm">
            Gifted items:
            <select
              value={giftedFilter}
              onChange={e => setGiftedFilter(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1"
            >
              <option value="">All</option>
              <option value="yes">Yes</option>
              <option value="no">No</option>
            </select>
          </label>
          <label className="flex items-center gap-1 text-sm">
            Visit Type:
            <select
              value={visitTypeFilter}
              onChange={e => setVisitTypeFilter(e.target.value)}
              className="border border-gray-300 rounded px-2 py-1"
            >
              <option value="">All</option>
              <option value="Leaving Well">Leaving Well</option>
              <option value="Day 29">Day 29</option>
              <option value="Mutual Change">Mutual Exchange</option>
            </select>
          </label>
        </div>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Total Submissions</strong>
          <div>{totalSubmissions}</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Major %</strong>
          <div>{((majorCount / totalSubmissions) * 100 || 0).toFixed(1)}%</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Minor %</strong>
          <div>{((minorCount / totalSubmissions) * 100 || 0).toFixed(1)}%</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Voids with Recharges</strong>
          <div>{rechargeCount}</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>% with Recharges</strong>
          <div>{((rechargeCount / totalSubmissions) * 100 || 0).toFixed(1)}%</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Gifted Items %</strong>
          <div>{giftedPercent.toFixed(1)}%</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Average SMV</strong>
          <div>{avgSmv ? avgSmv.toFixed(2) : 'N/A'}</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Total Cost (£)</strong>
          <div>£{totalCost.toFixed(2)}</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Average Cost (£)</strong>
          <div>£{averageCost.toFixed(2)}</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Voids ≥ £7500</strong>
          <div>{highCostCount}</div>
        </div>
      </div>

      {/* Anchor for chart and summary table */}
      <div id="submissions-view">
        {/* Export Buttons */}
        <div className="mb-6 flex gap-4">
          <button
            onClick={exportToExcel}
            className="bg-amber-400 hover:bg-amber-500 text-white px-4 py-2 rounded shadow"
            type="button"
          >
            Export to Excel
          </button>
          <button
            onClick={exportToPDF}
            className="bg-amber-400 hover:bg-amber-500 text-white px-4 py-2 rounded shadow"
            type="button"
          >
            Export to PDF
          </button>
        </div>

        {/* Bar Chart */}
        <div className="mb-8 max-w-4xl">
          <canvas ref={chartRef} />
        </div>

        <div style={{ marginBottom: '1.5rem' }}>
          <div className="overflow-x-auto mb-8">
            <h2 className="text-xl font-semibold mb-4">Surveyor Summary</h2>
            <table className="min-w-full border border-gray-300 text-sm rounded overflow-hidden">
              <thead className="bg-amber-100 text-gray-700 font-semibold">
                <tr>
                  <th className="py-2 px-4 text-left">Surveyor</th>
                  <th className="py-2 px-4 text-right">Submissions</th>
                  <th className="py-2 px-4 text-right">Avg Cost</th>
                  <th className="py-2 px-4 text-right">Recharge Count</th>
                  <th className="py-2 px-4 text-left">Visit Types</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200 bg-white">
                {Object.entries(
                  filteredSubmissions.reduce((acc, sub) => {
                    const name = sub.surveyorName || 'Unknown';
                    if (!acc[name]) {
                      acc[name] = { count: 0, total: 0, rechargeCount: 0, visitTypes: {} };
                    }
                    acc[name].count += 1;
                    acc[name].total += parseFloat(sub.totals?.cost || 0);
                    const rechargeFound = Object.values(sub.sors || {}).some(section =>
                      (section || []).some(item => item.recharge)
                    );
                    if (rechargeFound) acc[name].rechargeCount += 1;
                    if (sub.visitTypes && typeof sub.visitTypes === 'object') {
                      Object.entries(sub.visitTypes).forEach(([type, count]) => {
                        if (!acc[name].visitTypes[type]) acc[name].visitTypes[type] = 0;
                        acc[name].visitTypes[type] += count;
                      });
                    }
                    return acc;
                  }, {})
                )
                  .map(([name, data]) => (
                    <tr key={name} className="hover:bg-amber-50 transition">
                      <td className="py-2 px-4 font-medium">
                        <button
                          onClick={() => setFilterText(name)}
                          className="text-blue-700 underline hover:text-blue-900"
                          type="button"
                        >
                          {name}
                        </button>
                      </td>
                      <td className="py-2 px-4 text-right">{data.count}</td>
                      <td className="py-2 px-4 text-right">£{(data.total / data.count).toFixed(2)}</td>
                      <td className="py-2 px-4 text-right">{data.rechargeCount}</td>
                      <td className="py-2 px-4 text-left">
                        {Object.entries(data.visitTypes).map(([type, count]) => (
                          <span key={type} className="mr-2 inline-block bg-amber-200 rounded px-2 py-0.5 text-xs font-semibold text-amber-800">
                            {type}: {count}
                          </span>
                        ))}
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto mt-8">
        <h2 className="text-xl font-semibold mb-4">Voids ≥ £7500</h2>
        <table className="min-w-full border border-gray-300 text-sm rounded overflow-hidden">
          <thead className="bg-amber-100 text-gray-700 font-semibold">
            <tr>
              <th className="py-2 px-4 text-left">Surveyor</th>
              <th className="py-2 px-4 text-left">Property</th>
              <th className="py-2 px-4 text-right">Total Cost (£)</th>
              <th className="py-2 px-4 text-left">Submitted</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {filteredSubmissions
              .filter(sub => parseFloat(sub.totals?.cost || 0) >= 7500)
              .map(sub => (
                <tr key={sub.id} className="hover:bg-amber-50 transition">
                  <td className="py-2 px-4">{sub.surveyorName || 'Unknown'}</td>
                  <td className="py-2 px-4">{sub.propertyAddress || 'N/A'}</td>
                  <td className="py-2 px-4 text-right">£{parseFloat(sub.totals?.cost).toFixed(2)}</td>
                  <td className="py-2 px-4">{sub.submittedAt ? new Date(sub.submittedAt).toLocaleDateString() : 'N/A'}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>

      {/* Scrollable Submissions Table */}
      <div className="overflow-x-auto mt-8 max-h-[400px] border border-gray-300 rounded">
        <h2 className="text-xl font-semibold mb-4 px-4 pt-4">All Submissions</h2>
        <table className="min-w-full text-sm">
          <thead className="bg-amber-100 text-gray-700 font-semibold sticky top-0">
            <tr>
              <th className="py-2 px-4 text-left border-b border-gray-300">Surveyor</th>
              <th className="py-2 px-4 text-left border-b border-gray-300">Property</th>
              <th className="py-2 px-4 text-right border-b border-gray-300">Total Cost (£)</th>
              <th className="py-2 px-4 text-left border-b border-gray-300">Submitted</th>
              <th className="py-2 px-4 text-left border-b border-gray-300">Gifted Items Notes</th>
              <th className="py-2 px-4 text-left border-b border-gray-300">Void Type</th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredSubmissions.map(sub => (
              <tr key={sub.id} className="hover:bg-amber-50 transition">
                <td className="py-2 px-4">{sub.surveyorName || 'N/A'}</td>
                <td className="py-2 px-4">{sub.propertyAddress || 'N/A'}</td>
                <td className="py-2 px-4 text-right">{sub.totals?.cost ? Number(sub.totals.cost).toFixed(2) : 'N/A'}</td>
                <td className="py-2 px-4">{sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : 'N/A'}</td>
                <td className="py-2 px-4">{sub.giftedItemsNotes || ''}</td>
                <td className="py-2 px-4">{sub.voidType || 'N/A'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}