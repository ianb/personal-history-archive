async function sendPage(url, pageData) {
  try {
    console.info("Sending:", url, Object.keys(pageData).join(", "));
    let resp = await fetch(`${SERVER}/add-fetched-page`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        url,
        data: pageData
      })
    });
    if (!resp.ok) {
      throw new Error(`Bad response: ${resp.status} ${resp.statusText}`);
    }
    console.info("Send data on", url);
  } catch (error) {
    console.error("Error sending data for", url, ":", error);
    throw error;
  }
}
