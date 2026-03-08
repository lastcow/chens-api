export default function Home() {
  return (
    <div style={{ fontFamily: "monospace", padding: "2rem", background: "#0a0a0a", color: "#e5e5e5", minHeight: "100vh" }}>
      <h1 style={{ color: "#d4af37" }}>ChensAPI</h1>
      <p style={{ color: "#888" }}>v1.0.0 — Internal API service. All endpoints require <code>x-api-key</code> header.</p>
      <hr style={{ borderColor: "#333", margin: "1.5rem 0" }} />
      <h2 style={{ fontSize: "1rem", color: "#aaa" }}>Endpoints</h2>
      <table style={{ borderCollapse: "collapse", width: "100%" }}>
        <thead>
          <tr style={{ color: "#d4af37" }}>
            <th style={{ textAlign: "left", padding: "0.5rem 1rem 0.5rem 0" }}>Method</th>
            <th style={{ textAlign: "left", padding: "0.5rem 1rem 0.5rem 0" }}>Path</th>
            <th style={{ textAlign: "left", padding: "0.5rem 0" }}>Description</th>
          </tr>
        </thead>
        <tbody style={{ color: "#ccc" }}>
          {[
            ["GET",    "/api/health",         "Health check (public)"],
            ["POST",   "/api/auth/register",  "Register new user"],
            ["POST",   "/api/auth/login",     "Verify credentials"],
            ["POST",   "/api/auth/google",    "Upsert Google OAuth user"],
            ["GET",    "/api/users",          "List all users (admin)"],
            ["GET",    "/api/users/:id",      "Get user by ID"],
            ["PATCH",  "/api/users/:id",      "Update user"],
            ["DELETE", "/api/users/:id",      "Delete user (admin)"],
          ].map(([method, path, desc]) => (
            <tr key={path} style={{ borderTop: "1px solid #222" }}>
              <td style={{ padding: "0.5rem 1rem 0.5rem 0", color: method === "GET" ? "#4ade80" : method === "POST" ? "#60a5fa" : method === "PATCH" ? "#fbbf24" : "#f87171" }}>{method}</td>
              <td style={{ padding: "0.5rem 1rem 0.5rem 0" }}><code>{path}</code></td>
              <td style={{ padding: "0.5rem 0", color: "#888" }}>{desc}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
