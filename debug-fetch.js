
async function testFetch() {
  const url = "https://api.dabby.com.cn/v2/api/getaccesstoken";
  const params = new URLSearchParams({
    clientId: "test",
    clientSecret: "test"
  });
  const fullUrl = `${url}?${params.toString()}`;
  
  console.log(`Fetching ${fullUrl}...`);
  
  try {
    const response = await fetch(fullUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
    });
    console.log(`Status: ${response.status}`);
    const text = await response.text();
    console.log(`Body: ${text.substring(0, 100)}...`);
  } catch (error) {
    console.error("Fetch failed:", error);
    if (error.cause) {
      console.error("Cause:", error.cause);
    }
  }
}

testFetch();
