

'use client';

import { useEffect, useState } from 'react';
import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

export default function SubmissionsPage() {
  const [submissions, setSubmissions] = useState([]);
  const [loading, setLoading] = useState(true);

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
      <ul className="space-y-4">
        {submissions.map(sub => {
          let submittedDate = 'Invalid Date';
          try {
            submittedDate = sub.timestamp?.toDate
              ? sub.timestamp.toDate().toLocaleString()
              : new Date(sub.timestamp).toLocaleString();
          } catch (e) {
            submittedDate = 'Invalid Date';
          }

          return (
            <li key={sub.id} className="border p-4 rounded shadow">
              <p><strong>Surveyor:</strong> {sub.surveyorName || 'N/A'}</p>
              <p><strong>Property:</strong> {sub.propertyAddress || 'N/A'}</p>
              <p><strong>Total Cost:</strong> £{Number(sub.totalCost || 0).toFixed(2)}</p>
              <p><strong>Submitted:</strong> {submittedDate}</p>
            </li>
          );
        })}
      </ul>
    </div>
  );
}