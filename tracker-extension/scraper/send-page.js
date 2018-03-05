function sendPage(url, pageData) {
  console.info("Sending:", url, Object.keys(pageData).join(", "));
  return fetch(`${SERVER}/add-fetched-page`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      url,
      data: pageData
    })
  }).then((resp) => {
    if (!resp.ok) {
      throw new Error(`Bad response: ${resp.status} ${resp.statusText}`);
    }
    console.info("Send data on", url);
  }).catch((error) => {
    console.error("Error sending data for", url, ":", error);
    throw error;
  });
}
