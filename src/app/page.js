export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 px-6 py-12 font-sans text-gray-800">
      <div className="max-w-6xl mx-auto space-y-14">
        <header className="mb-16 text-center bg-white bg-opacity-70 rounded-xl shadow-sm py-8 px-4">
          <img src="/bromford-logo.png" alt="Bromford Logo" className="mx-auto mb-4 h-14" />
          <h1 className="text-4xl font-extrabold text-gray-900">Empty Homes Hub</h1>
          <p className="text-gray-700 mt-3 text-lg font-medium max-w-2xl mx-auto">
            A central hub for insight, planning, and delivery as part of our two-year empty homes plan
          </p>
        </header>

        <section className="mb-14">
          <h2 className="text-2xl font-semibold mb-4 text-gray-800">What these tools do:</h2>
          <ul className="list-disc list-inside text-lg leading-8 space-y-1 text-gray-700">
            <li>📋 <strong>Data capture</strong> via apps like the SOR form</li>
            <li>📊 <strong>Data visualization</strong> tailored for surveyors, managers, execs</li>
            <li>🗺️ <strong>Demand planning</strong> with postcode-level insights & overlays</li>
            <li>🔄 <strong>Decision support tools</strong> for refurb, allocation & coverage</li>
          </ul>
        </section>

        <section>
          <h2 className="text-2xl font-semibold mb-6 text-gray-800">Jump to a tool:</h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
            <a href="/submissions" className="group block p-6 bg-white border border-gray-200 rounded-lg shadow hover:shadow-md hover:scale-[1.01] transition-all duration-200">
              <h3 className="text-lg font-semibold mb-1 text-green-700 group-hover:text-green-800">✅ View SOR Submissions</h3>
              <p className="text-gray-600">Browse survey entries, costs, SMVs, and recharge data.</p>
            </a>
            <a href="/demand-map" className="group block p-6 bg-white border border-gray-200 rounded-lg shadow hover:shadow-md hover:scale-[1.01] transition-all duration-200">
              <h3 className="text-lg font-semibold mb-1 text-pink-700 group-hover:text-pink-800">📍 Demand Map</h3>
              <p className="text-gray-600">Interactive postcode-level map of voids and patch overlap.</p>
            </a>
            <a href="/exec-overview" className="group block p-6 bg-white border border-gray-200 rounded-lg shadow hover:shadow-md hover:scale-[1.01] transition-all duration-200">
              <h3 className="text-lg font-semibold mb-1 text-blue-700 group-hover:text-blue-800">📈 Exec Overview</h3>
              <p className="text-gray-600">High-level performance, cost trends, and impact visualisations.</p>
            </a>
            <a href="/recharges" className="group block p-6 bg-white border border-gray-200 rounded-lg shadow hover:shadow-md hover:scale-[1.01] transition-all duration-200">
              <h3 className="text-lg font-semibold mb-1 text-indigo-700 group-hover:text-indigo-800">📝 Recharges & Quoted Work</h3>
              <p className="text-gray-600">Review tenant damage, additional costs, and contractor input.</p>
            </a>
            <a href="/upload" className="group block p-6 bg-white border border-gray-200 rounded-lg shadow hover:shadow-md hover:scale-[1.01] transition-all duration-200">
              <h3 className="text-lg font-semibold mb-1 text-cyan-700 group-hover:text-cyan-800">🔄 Upload Historical Data</h3>
              <p className="text-gray-600">Import CSVs to support trend and demand planning.</p>
            </a>
            <a href="/admin" className="group block p-6 bg-white border border-gray-200 rounded-lg shadow hover:shadow-md hover:scale-[1.01] transition-all duration-200">
              <h3 className="text-lg font-semibold mb-1 text-gray-700 group-hover:text-gray-800">🔐 Admin / Setup</h3>
              <p className="text-gray-600">Control configuration, data sources and integrations.</p>
            </a>
          </div>
        </section>
      </div>
    </main>
  );
}
