// Renders a report from the API into HTML. Shared by the website pages.
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const VERDICT_LABEL = { supported: "Supported", contradicted: "Contradicted", misleading: "Misleading wording", unverifiable: "Can't verify" };
const ORDER = ["contradicted", "misleading", "unverifiable", "supported"];

export function renderReport(r) {
  const name = r.product.name || "Unnamed product";
  const parts = [];

  parts.push(`<div class="r-head"><div>
      <div class="label">${esc(r.product.brand || "Unknown brand")} · ${esc(r.product.category.replace("_", " "))}</div>
      <h2>${esc(name)}</h2>
      ${r.product.gtin ? `<div class="src">Barcode ${esc(r.product.gtin.replace(/^0+(?=\d{12,13}$)/, ""))}</div>` : ""}
    </div>
    <div class="counts">${ORDER.filter((v) => r.counts[v]).map((v) => `<span class="pill v-${v}">${r.counts[v]} ${VERDICT_LABEL[v]}</span>`).join("")}</div>
  </div>`);

  if (r.sampleMode) parts.push(`<div class="notice">Sample mode: no AI reading yet. These results use simple text matching or example data.</div>`);

  if (r.contradictions.length) {
    parts.push(`<section><div class="label">Doesn't add up</div>${r.contradictions.map((c) => `<div class="contra"><b>${esc(c.title)}</b><span>${esc(c.detail)}</span></div>`).join("")}</section>`);
  }

  // Materials
  if (r.materials.length) {
    const sum = r.materialSummary;
    const sumText = sum && (sum.text ?? (sum.plasticShare != null ? `${sum.plasticShare}% plastic-based fibers, ${sum.naturalShare}% natural.` : null));
    const summary = sumText ? `<p class="muted">${esc(sumText)}${sum.hasPlasticLeather ? " Contains plastic \"leather\"." : ""}</p>` : "";
    parts.push(`<section class="panel"><h3>What it's made of</h3>${summary}
      ${r.materials.map((p) => `<div><div class="label">${esc(p.part)} · from the ${esc(p.from)}</div>
        ${p.components.map((c) => `<div class="mat"><span class="pct">${c.percent != null ? c.percent + "%" : "—"}</span><span><b>${esc(c.label)}</b><br><span class="muted">${esc(c.plain)}</span></span></div>`).join("")}
      </div>`).join("")}
      ${r.jewelryMarks.length ? `<p class="muted">Stamps: ${r.jewelryMarks.map(esc).join(", ")}</p>` : ""}
    </section>`);
  }

  // Claims
  if (r.claims.length) {
    const sorted = [...r.claims].sort((a, b) => ORDER.indexOf(a.verdict) - ORDER.indexOf(b.verdict));
    parts.push(`<section class="panel"><h3>Claims checked</h3><ul class="list">${sorted
      .map((c) => `<li><div class="top"><span class="quote">“${esc(c.quote)}”</span><span class="pill v-${c.verdict}">${VERDICT_LABEL[c.verdict]}</span></div>
        <span>${esc(c.reason)}</span>
        <span class="src">From the ${esc(c.from)}${c.basis ? " · Source: " + esc(c.basis) : ""}</span></li>`)
      .join("")}</ul></section>`);
  }

  // Wording
  if (r.wording.length) {
    parts.push(`<section class="panel"><h3>Sales wording decoded</h3><ul class="list">${r.wording
      .map((w) => `<li><div class="top"><span class="quote">${esc(w.title)}</span>${w.verdict === "misleading" ? '<span class="pill v-misleading">Misleading wording</span>' : ""}</div>
        <span>${esc(w.meaning)}</span><span class="src">Source: ${esc(w.basis)}</span></li>`)
      .join("")}</ul></section>`);
  }

  // Origin
  const o = r.origin;
  parts.push(`<section class="panel"><div class="r-head"><h3>Where it's made</h3><span class="pill g-${o.grade}">${esc(o.gradeLabel)}</span></div>
    ${o.text ? `<p><b>“${esc(o.text)}”</b></p>` : ""}
    <p class="muted">${esc(o.explanation)} ${esc(o.gradeExplanation)}</p>
    <ul class="ladder">${o.ladder.map((s) => `<li class="${s.country ? "known" : ""}"><span>${esc(s.label)}</span><span class="c">${esc(s.country || "not disclosed")}</span></li>`).join("")}</ul>
    ${o.design ? `<p class="muted">Designed in ${esc(o.design)}.</p>` : ""}
  </section>`);

  if (r.certifications.length) {
    parts.push(`<section class="panel"><h3>Certifications mentioned</h3><ul class="list">${r.certifications.map((c) => `<li><span class="quote">${esc(c.name)}${c.id ? " · " + esc(c.id) : ""}</span><span class="muted">${esc(c.status)}</span></li>`).join("")}</ul></section>`);
  }
  if (r.care.length) parts.push(`<section class="panel"><h3>Care</h3><p class="muted">${r.care.map(esc).join(" · ")}</p></section>`);

  const srcs = r.sources.map((s) => `${s.type === "label" ? "Label" : "Listing"}${s.url ? ` (<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(new URL(s.url).hostname)}</a>)` : ""}, read ${new Date(s.readAt).toLocaleDateString()}`);
  parts.push(`<section><div class="label">Based on</div><p class="muted">${srcs.join(" · ")}</p>${r.notes.length ? `<ul class="notes">${r.notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""}</section>`);

  return `<div class="report">${parts.join("")}</div>`;
}

export { esc };
