export async function api(path, { method = "GET", body, form } = {}) {
  const opts = { method, credentials: "same-origin", headers: {} };

  if (form) {
    opts.body = form;
  } else if (body !== undefined) {
    opts.headers["Content-Type"] = "application/json";
    opts.body = JSON.stringify(body);
  }

  const res = await fetch("/api" + path, opts);
  let data = null;

  try {
    data = await res.json();
  } catch (e) {
    /* no body */
    console.log("ERROR: ", e);
  }

  if (!res.ok) {
    const err = new Error((data && data.error) || "Something went wrong");
    err.status = res.status;
    err.details = data && data.details;
    throw err;
  }

  return data;
}
