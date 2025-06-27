'use client';

// Redeploy trigger comment
'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

export default function SubmissionsPage() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filterText, setFilterText] = useState("");

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

  if (loading) {
    return <p className="text-center mt-8">Loading submissions...</p>;
  }

  if (submissions.length === 0) {
    return <p className="text-center mt-8">No submissions found.</p>;
  }

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      <h1 className="text-2xl font-bold mb-6">SOR Submissions</h1>
      <div className="overflow-x-auto mb-8">
        <h2 className="text-xl font-semibold mb-4">Surveyor Summary</h2>
        <Form className="mb-4">
          <Form.Group controlId="filterSurveyor">
            <Form.Label className="text-sm font-medium text-gray-700">Filter by Surveyor Name</Form.Label>
            <Form.Control
              type="text"
              placeholder="Type a surveyor name..."
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
              className="mt-1 block w-full max-w-sm"
            />
          </Form.Group>
        </Form>
        <table className="min-w-full border border-gray-300 text-sm rounded overflow-hidden">
          <thead className="bg-gray-200 text-gray-700 font-semibold">
            <tr>
              <th className="py-2 px-4 text-left">Surveyor</th>
              <th className="py-2 px-4 text-right">Submissions</th>
              <th className="py-2 px-4 text-right">Avg Cost</th>
              <th className="py-2 px-4 text-right">Recharge Count</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-200 bg-white">
            {Object.entries(
              submissions.reduce((acc, sub) => {
                const name = sub.surveyorName || 'Unknown';
                if (!acc[name]) {
                  acc[name] = { count: 0, total: 0, rechargeCount: 0 };
                }
                acc[name].count += 1;
                acc[name].total += parseFloat(sub.totals?.cost || 0);
                const rechargeFound = Object.values(sub.sors || {}).some(section =>
                  (section || []).some(item => item.recharge)
                );
                if (rechargeFound) acc[name].rechargeCount += 1;
                return acc;
              }, {})
            )
              .filter(([name]) => name.toLowerCase().includes(filterText.toLowerCase()))
              .map(([name, data]) => (
                <tr key={name}>
                  <td className="py-2 px-4 font-medium">{name}</td>
                  <td className="py-2 px-4 text-right">{data.count}</td>
                  <td className="py-2 px-4 text-right">£{(data.total / data.count).toFixed(2)}</td>
                  <td className="py-2 px-4 text-right">{data.rechargeCount}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      <ul className="space-y-4">
        {submissions.map(sub => {
          let submittedDate = 'Invalid Date';
          try {
            submittedDate = sub.submittedAt
              ? new Date(sub.submittedAt).toLocaleString()
              : 'Invalid Date';
          } catch (e) {
            submittedDate = 'Invalid Date';
          }

          return (
            <li key={sub.id} className="bg-white text-gray-900 border border-gray-300 p-4 rounded shadow-sm hover:shadow-md transition-shadow duration-200">
              <p className="mb-1"><strong>Surveyor:</strong> {sub.surveyorName || 'N/A'}</p>
              <p className="mb-1"><strong>Property:</strong> {sub.propertyAddress || 'N/A'}</p>
              <p className="mb-1"><strong>Total Cost:</strong> £{sub.totals?.cost ? Number(sub.totals.cost).toFixed(2) : 'N/A'}</p>
              <p className="mb-1"><strong>Submitted:</strong> {sub.submittedAt ? new Date(sub.submittedAt).toLocaleString() : 'N/A'}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}