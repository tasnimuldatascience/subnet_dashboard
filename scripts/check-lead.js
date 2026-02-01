const https = require("https");

const emailHash = process.argv[2] || "d2f35358d94ac9fb9c354564ed693c962cb53eeef3d916d4dc1768e1415ccf80";
const url = `https://qplwoislplkcegvdmbim.supabase.co/rest/v1/transparency_log?select=payload,event_type,ts&email_hash=eq.${emailHash}&order=ts.desc`;
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFwbHdvaXNscGxrY2VndmRtYmltIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NDQ4NDcwMDUsImV4cCI6MjA2MDQyMzAwNX0.5E0WjAthYDXaCWY6qjzXm2k20EhadWfigak9hleKZk8";

https.get(url, { headers: { "apikey": key, "Authorization": "Bearer " + key } }, (res) => {
  let data = "";
  res.on("data", chunk => data += chunk);
  res.on("end", () => {
    console.log("Raw response:", data.substring(0, 500));
    const rows = JSON.parse(data);
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log("No records found for email_hash:", emailHash);
      return;
    }
    rows.forEach(row => {
      console.log("Event:", row.event_type);
      console.log("Timestamp:", row.ts);
      const p = row.payload;
      if (p.final_rep_score !== undefined) {
        console.log("final_rep_score:", p.final_rep_score);
        console.log("is_icp_multiplier:", p.is_icp_multiplier);
        console.log("Sum:", (p.final_rep_score || 0) + (p.is_icp_multiplier || 0));
      }
      console.log("---");
    });
  });
});
