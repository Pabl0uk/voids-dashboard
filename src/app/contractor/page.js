'use client';
import React from 'react';
import { collection, getDocs } from "firebase/firestore";
import { db } from '../lib/firebase';
import { useEffect, useState } from "react";
import { Chart, LineController, LineElement, PointElement, LinearScale, Title, CategoryScale, Tooltip, Legend } from 'chart.js';

Chart.register(LineController, LineElement, PointElement, LinearScale, Title, CategoryScale, Tooltip, Legend);

const getAllQuotedWorks = worksObj => {
  if (Array.isArray(worksObj)) {
    return worksObj;
  }
  if (typeof worksObj === "object" && worksObj !== null) {
    return Object.values(worksObj).flatMap(section =>
      Array.isArray(section) ? section : []
    );
  }
  return [];
};

export default function ContractorDashboard() {
  const [dataLoaded, setDataLoaded] = useState(false);
  const [filteredData, setFilteredData] = useState([]);
  const [surveyorFilter, setSurveyorFilter] = useState("");
  const [monthFilter, setMonthFilter] = useState("");
  const [workTypeFilter, setWorkTypeFilter] = useState("");
  const [expandedSurveyor, setExpandedSurveyor] = useState(null);

  useEffect(() => {
    const fetchData = async () => {
      const snapshot = await getDocs(collection(db, "surveys"));
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setFilteredData(data);
      setDataLoaded(true);
    };
    fetchData();
  }, []);

  const filteredByParams = filteredData.filter(s => {
    const matchesSurveyor = !surveyorFilter || s.surveyorName === surveyorFilter;
    const matchesMonth =
      !monthFilter ||
      (s.submittedAt &&
        new Date(s.submittedAt).toLocaleDateString("en-GB", {
          year: "numeric",
          month: "short",
        }) === monthFilter);
    return matchesSurveyor && matchesMonth;
  });

  const contractorVoids = filteredByParams.filter(s => {
    const allWorks = getAllQuotedWorks(s.sors?.["contractor work"]);
    return allWorks.some(qw =>
      qw &&
      (Number(qw.cost) > 0 ||
       (typeof qw.description === "string" && qw.description.trim() !== "") ||
       (typeof qw.comment === "string" && qw.comment.trim() !== ""))
    );
  });

  let contractorWorks = contractorVoids.reduce((acc, s) => {
    const allWorks = getAllQuotedWorks(s.sors?.["contractor work"]);
    const validQuotedWorks = allWorks.filter(qw =>
      qw &&
      (Number(qw.cost) > 0 ||
       (typeof qw.description === "string" && qw.description.trim() !== "") ||
       (typeof qw.comment === "string" && qw.comment.trim() !== ""))
    ).map(qw => ({
      ...qw,
      surveyorName: s.surveyorName,
      propertyAddress: s.propertyAddress,
      submittedAt: s.submittedAt
    }));
    return acc.concat(validQuotedWorks);
  }, []);

  // Calculate total and average time estimate (in minutes)
  const totalTimeEstimate = contractorWorks.reduce((acc, qw) => acc + (Number(qw.timeEstimate) || 0), 0);
  const avgTimeEstimate = contractorWorks.length > 0 ? totalTimeEstimate / contractorWorks.length : 0;

  // Apply workTypeFilter to contractorWorks
  if (workTypeFilter) {
    contractorWorks = contractorWorks.filter(w => w.description === workTypeFilter);
  }

  const totalContractorCost = contractorWorks.reduce((acc, qw) => acc + (Number(qw.cost) || 0), 0);
  const avgContractorCost = contractorWorks.length > 0 ? totalContractorCost / contractorWorks.length : 0;

  const contractorBySurveyor = contractorVoids.reduce((acc, s) => {
    const name = s.surveyorName || "Unknown";
    acc[name] = (acc[name] || 0) + 1;
    return acc;
  }, {});

  // Apply workTypeFilter to contractorVoids for monthly trend and by surveyor counts
  const filteredContractorVoids = workTypeFilter
    ? contractorVoids.filter(s => {
        const allWorks = getAllQuotedWorks(s.sors?.["contractor work"]);
        return allWorks.some(qw =>
          qw &&
          qw.description === workTypeFilter &&
          (Number(qw.cost) > 0 ||
           (typeof qw.description === "string" && qw.description.trim() !== "") ||
           (typeof qw.comment === "string" && qw.comment.trim() !== ""))
        );
      })
    : contractorVoids;

  const contractorDescriptionCounts = contractorWorks.reduce((acc, qw) => {
    const desc = qw.description || "Unknown";
    acc[desc] = (acc[desc] || 0) + 1;
    return acc;
  }, {});

  const totalSubmissions = filteredData.length;
  const voidsWithContractorWork = filteredContractorVoids.length;
  const contractorPercentage = totalSubmissions > 0 ? (voidsWithContractorWork / totalSubmissions) * 100 : 0;

  // Get distinct descriptions for work type filter dropdown
  const distinctDescriptions = [...new Set(filteredData.flatMap(s => {
    const works = getAllQuotedWorks(s.sors?.["contractor work"]);
    return works.map(w => w.description).filter(Boolean);
  }))].sort();

  // Prepare monthly data for chart and table
  const monthlyDataMap = filteredContractorVoids.reduce((acc, s) => {
    const month = s.submittedAt
      ? new Date(s.submittedAt).toLocaleDateString("en-GB", {
          year: "numeric",
          month: "short",
        })
      : "Unknown";
    acc[month] = acc[month] || { count: 0, totalCost: 0 };
    acc[month].count += 1;

    // Sum costs for this survey's contractor works filtered by workTypeFilter if set
    const allWorks = getAllQuotedWorks(s.sors?.["contractor work"]);
    const filteredWorks = workTypeFilter ? allWorks.filter(w => w.description === workTypeFilter) : allWorks;
    const totalCostForSurvey = filteredWorks.reduce((sum, w) => sum + (Number(w.cost) || 0), 0);
    acc[month].totalCost += totalCostForSurvey;

    return acc;
  }, {});

  // Sort months chronologically for chart and table
  const sortedMonths = Object.keys(monthlyDataMap).sort((a, b) => new Date(`01 ${a}`) - new Date(`01 ${b}`));

  // Chart.js setup
  const chartRef = (canvas) => {
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (canvas.chart) {
      canvas.chart.destroy();
    }
    canvas.chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: sortedMonths,
        datasets: [
          {
            label: 'Voids with Contractor Work',
            data: sortedMonths.map(m => monthlyDataMap[m].count),
            borderColor: '#2563eb',
            backgroundColor: 'rgba(37, 99, 235, 0.3)',
            yAxisID: 'y',
          },
          {
            label: 'Total Contractor Cost (£)',
            data: sortedMonths.map(m => monthlyDataMap[m].totalCost.toFixed(2)),
            borderColor: '#f97316',
            backgroundColor: 'rgba(249, 115, 22, 0.3)',
            yAxisID: 'y1',
          }
        ],
      },
      options: {
        responsive: true,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        stacked: false,
        scales: {
          y: {
            type: 'linear',
            display: true,
            position: 'left',
            title: {
              display: true,
              text: 'Voids Count',
            },
          },
          y1: {
            type: 'linear',
            display: true,
            position: 'right',
            grid: {
              drawOnChartArea: false,
            },
            title: {
              display: true,
              text: 'Total Cost (£)',
            },
          },
        },
        plugins: {
          legend: {
            position: 'top',
          },
          title: {
            display: true,
            text: 'Monthly Contractor Work and Cost Trend',
          },
        },
      },
    });
  };

  return (
    <div style={{ padding: '2rem', backgroundColor: '#f9fafb', color: '#111827', minHeight: '100vh', fontFamily: 'system-ui' }}>
      <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '1rem' }}>🛠️ Contractor Dashboard</h1>
      <div style={{ display: 'flex', gap: '1rem', marginBottom: '1rem' }}>
        <select value={surveyorFilter} onChange={e => setSurveyorFilter(e.target.value)}>
          <option value="">All Surveyors</option>
          {[...new Set(filteredData.map(s => s.surveyorName))].map(name => (
            <option key={name} value={name}>{name}</option>
          ))}
        </select>

        <select value={monthFilter} onChange={e => setMonthFilter(e.target.value)}>
          <option value="">All Months</option>
          {[...new Set(filteredData.map(s =>
            s.submittedAt &&
            new Date(s.submittedAt).toLocaleDateString("en-GB", {
              year: "numeric",
              month: "short"
            })
          ))].filter(Boolean).map(month => (
            <option key={month} value={month}>{month}</option>
          ))}
        </select>

        <select value={workTypeFilter} onChange={e => setWorkTypeFilter(e.target.value)}>
          <option value="">Filter by Work Type</option>
          {distinctDescriptions.map(desc => (
            <option key={desc} value={desc}>{desc}</option>
          ))}
        </select>

        <button onClick={() => { setSurveyorFilter(""); setMonthFilter(""); setWorkTypeFilter(""); setExpandedSurveyor(null); }}>
          Reset Filters
        </button>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1rem', marginBottom: '1.5rem' }}>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Total Submissions</strong>
          <div>{totalSubmissions}</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Voids with Contractor Work</strong>
          <div>{voidsWithContractorWork}</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>% with Contractor Work</strong>
          <div>{contractorPercentage.toFixed(1)}%</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Total Contractor Cost (£)</strong>
          <div>{totalContractorCost.toFixed(2)}</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Average Contractor Cost (£)</strong>
          <div>{avgContractorCost.toFixed(2)}</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Total Time Estimate (hrs)</strong>
          <div>{(totalTimeEstimate / 60).toFixed(1)}</div>
        </div>
        <div style={{ backgroundColor: '#fff7ed', padding: '1rem', borderRadius: '0.5rem', minWidth: '200px' }}>
          <strong>Avg Time per Entry (hrs)</strong>
          <div>{(avgTimeEstimate / 60).toFixed(2)}</div>
        </div>
      </div>

      <div style={{ marginBottom: '2rem' }}>
        <canvas ref={chartRef} style={{ maxHeight: '400px', width: '100%' }} />
      </div>

      <div style={{ marginTop: '1rem' }}>
        <button
          onClick={() => {
            const csvContent = [
              ['Surveyor', 'Property', 'Description', 'Cost', 'Comment', 'Submitted At'],
              ...contractorWorks.map(w =>
                [
                  w.surveyorName,
                  w.propertyAddress,
                  w.description,
                  w.cost,
                  w.comment || '',
                  new Date(w.submittedAt).toLocaleDateString()
                ]
              )
            ]
              .map(e => e.join(','))
              .join('\n');

            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', 'contractor_work_export.csv');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer',
          }}
        >
          Export Contractor Work CSV
        </button>
        <button
          onClick={() => {
            const jsonBlob = new Blob([JSON.stringify(contractorWorks, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(jsonBlob);
            const link = document.createElement('a');
            link.setAttribute('href', url);
            link.setAttribute('download', 'contractor_work_export.json');
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
          }}
          style={{
            padding: '0.5rem 1rem',
            backgroundColor: '#4b5563',
            color: 'white',
            border: 'none',
            borderRadius: '0.375rem',
            cursor: 'pointer',
            marginLeft: '1rem'
          }}
        >
          Export Contractor Work JSON
        </button>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>Monthly Contractor Work Trend</h2>
        <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Month</th>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Voids with Contractor Work</th>
              </tr>
            </thead>
            <tbody>
              {sortedMonths.map(month => (
                <tr key={month}>
                  <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{month}</td>
                  <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{monthlyDataMap[month].count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>Breakdown by Surveyor</h2>
        <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Surveyor</th>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Voids with Contractor Work</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(contractorBySurveyor).map(([name, count]) => (
                <React.Fragment key={name}>
                  <tr>
                    <td
                      style={{ border: '1px solid #ddd', padding: '0.5rem', cursor: 'pointer', color: '#2563eb', textDecoration: 'underline' }}
                      onClick={() => setExpandedSurveyor(expandedSurveyor === name ? null : name)}
                      tabIndex={0}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          setExpandedSurveyor(expandedSurveyor === name ? null : name);
                        }
                      }}
                      role="button"
                      aria-expanded={expandedSurveyor === name}
                      aria-controls={`surveyor-details-${name}`}
                    >
                      {name}
                    </td>
                    <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{count}</td>
                  </tr>
                  {expandedSurveyor === name && (
                    <tr id={`surveyor-details-${name}`}>
                      <td colSpan={2} style={{ border: '1px solid #ddd', padding: '0.5rem', backgroundColor: '#f3f4f6' }}>
                        <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                            <thead>
                              <tr>
                                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Property Address</th>
                                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Description</th>
                                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Cost (£)</th>
                                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Comment</th>
                                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Submitted At</th>
                              </tr>
                            </thead>
                            <tbody>
                              {contractorWorks.filter(w => w.surveyorName === name).map((work, idx) => (
                                <tr
                                  key={idx}
                                  style={{ backgroundColor: Number(work.cost) > 500 ? 'rgba(254, 202, 202, 0.5)' : 'transparent' }}
                                >
                                  <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{work.propertyAddress}</td>
                                  <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{work.description}</td>
                                  <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{Number(work.cost).toFixed(2)}</td>
                                  <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{work.comment || ''}</td>
                                  <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{new Date(work.submittedAt).toLocaleDateString()}</td>
                                </tr>
                              ))}
                              {contractorWorks.filter(w => w.surveyorName === name).length === 0 && (
                                <tr>
                                  <td colSpan={5} style={{ border: '1px solid #ddd', padding: '0.5rem', fontStyle: 'italic' }}>No contractor work entries for this surveyor with current filters.</td>
                                </tr>
                              )}
                            </tbody>
                          </table>
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ marginTop: '2rem' }}>
        <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>Most Common Contractor Work</h2>
        <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff' }}>
            <thead>
              <tr>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Description</th>
                <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Count</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(contractorDescriptionCounts)
                .sort((a, b) => b[1] - a[1])
                .slice(0, 10)
                .map(([desc, count]) => (
                  <tr key={desc}>
                    <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{desc}</td>
                    <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{count}</td>
                  </tr>
                ))}
              {Object.keys(contractorDescriptionCounts).length === 0 && (
                <tr>
                  <td colSpan={2} style={{ border: '1px solid #ddd', padding: '0.5rem', fontStyle: 'italic' }}>No contractor work descriptions found with current filters.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Top Contractors Section */}
      {(() => {
        // Calculate contractor counts and total cost
        const contractorCounts = contractorWorks.reduce((acc, qw) => {
          const name = qw.contractor || "Unknown";
          acc[name] = (acc[name] || { count: 0, totalCost: 0 });
          acc[name].count += 1;
          acc[name].totalCost += Number(qw.cost) || 0;
          return acc;
        }, {});
        return (
          <div style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>Top Contractors</h2>
            <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff' }}>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Contractor</th>
                    <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Count</th>
                    <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Total Cost (£)</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(contractorCounts)
                    .sort((a, b) => b[1].count - a[1].count)
                    .map(([name, stats]) => (
                      <tr key={name}>
                        <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{name}</td>
                        <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{stats.count}</td>
                        <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{stats.totalCost.toFixed(2)}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}

      {/* Cost Banding Section */}
      {(() => {
        const costBands = {
          '£0-100': 0,
          '£101-250': 0,
          '£251-500': 0,
          '£501+': 0,
        };
        contractorWorks.forEach(qw => {
          const cost = Number(qw.cost) || 0;
          if (cost <= 100) costBands['£0-100']++;
          else if (cost <= 250) costBands['£101-250']++;
          else if (cost <= 500) costBands['£251-500']++;
          else costBands['£501+']++;
        });
        return (
          <div style={{ marginTop: '2rem' }}>
            <h2 style={{ fontSize: '1.25rem', fontWeight: 'bold', marginBottom: '1rem' }}>Cost Banding</h2>
            <div style={{ overflowX: 'auto', maxHeight: '400px', overflowY: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', backgroundColor: '#fff' }}>
                <thead>
                  <tr>
                    <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Cost Range</th>
                    <th style={{ border: '1px solid #ddd', padding: '0.5rem' }}>Count</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(costBands).map(([range, count]) => (
                    <tr key={range}>
                      <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{range}</td>
                      <td style={{ border: '1px solid #ddd', padding: '0.5rem' }}>{count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })()}
    </div>
  );
}