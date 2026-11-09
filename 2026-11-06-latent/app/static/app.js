(function () {
  "use strict";
  var PRESETS = {
    grounded: {
      question: "What was Q3 revenue?",
      sources: "Q3 revenue was $3.1M, up 12% year over year.\nThe company has 42 employees.",
      answer_override: "Q3 revenue was $3.1M, up 12% year over year."
    },
    madeup: {
      question: "What was Q3 revenue?",
      sources: "Q3 revenue was $3.1M, up 12% year over year.\nThe company has 42 employees.",
      answer_override: "Q3 revenue was $4.2M, up 38%, according to CFO Dana Whitfield."
    }
  };

  function headers() {
    var h = { "content-type": "application/json" };
    try {
      var k = localStorage.getItem("latent_key");
      if (k) h["authorization"] = "Bearer " + k;
    } catch (e) { /* storage unavailable */ }
    return h;
  }

  function post(url, body) {
    return fetch(url, { method: "POST", headers: headers(), body: JSON.stringify(body || {}) })
      .then(function (r) {
        return r.json().then(function (j) { return { ok: r.ok, body: j }; });
      });
  }

  document.querySelectorAll("[data-preset]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var p = PRESETS[btn.dataset.preset];
      var f = document.getElementById("chat-form");
      f.question.value = p.question;
      f.sources.value = p.sources;
      f.answer_override.value = p.answer_override;
    });
  });

  document.getElementById("chat-form").addEventListener("submit", function (ev) {
    ev.preventDefault();
    var f = ev.target;
    var body = {
      question: f.question.value,
      sources: f.sources.value.split("\n").map(function (s) { return s.trim(); }).filter(Boolean),
      policy: f.policy.value
    };
    if (f.answer_override.value.trim()) body.answer_override = f.answer_override.value.trim();
    post("/v1/chat", body).then(function (res) {
      var out = document.getElementById("chat-out");
      out.hidden = false;
      if (!res.ok) { out.textContent = "Error: " + JSON.stringify(res.body); return; }
      var g = res.body.guarded;
      out.textContent = "Raw answer: " + res.body.raw_answer + "\n\nFlagged: " + g.flagged +
        " (score " + g.score + ", " + g.failure_type + ")\nAction: " + g.action +
        "\nFinal answer: " + g.final_answer;
      setTimeout(function () { location.reload(); }, 1500);
    });
  });

  document.querySelectorAll(".item button[data-decision]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var id = btn.closest(".item").dataset.id;
      post("/v1/reviews", { id: id, decision: btn.dataset.decision }).then(function () {
        location.reload();
      });
    });
  });

  document.getElementById("recal").addEventListener("click", function () {
    post("/v1/calibrate").then(function (res) {
      var out = document.getElementById("recal-out");
      if (!res.ok) { out.textContent = res.body.detail || "Calibration failed"; return; }
      var b = res.body;
      out.textContent = "Threshold " + b.threshold + " (labeled " + b.labeled_count +
        ", precision " + b.precision + ", recall " + b.recall + ")";
      document.getElementById("thr").textContent = b.threshold;
    });
  });
})();
