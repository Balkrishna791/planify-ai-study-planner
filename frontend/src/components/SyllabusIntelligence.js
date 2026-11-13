import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, BrainCircuit, CheckCircle2, FileQuestion, FileUp, Loader, ShieldCheck, Sparkles, Trash2 } from "lucide-react";
import "./SyllabusIntelligence.css";

const readablePriority = (signal) => signal >= 1.75 ? "High PYQ priority" : signal >= 0.75 ? "Medium PYQ priority" : "Low PYQ priority";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_PYQ_FILES = 5;

const invalidUploadMessage = (files, maximumFiles = 1) => {
  if (files.length > maximumFiles) return `Choose no more than ${maximumFiles} file${maximumFiles === 1 ? "" : "s"} at a time.`;
  const oversized = files.find((file) => file.size > MAX_UPLOAD_BYTES);
  return oversized ? `${oversized.name} is larger than 10 MB.` : "";
};

function SyllabusIntelligence({ refreshKey = 0 }) {
  const syllabusInputRef = useRef(null);
  const pyqInputRef = useRef(null);
  const [intelligence, setIntelligence] = useState(null);
  const [pending, setPending] = useState(null);
  const [syllabusFile, setSyllabusFile] = useState(null);
  const [pyqFiles, setPyqFiles] = useState([]);
  const [paperLabel, setPaperLabel] = useState("");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [replaceMode, setReplaceMode] = useState(false);

  const loadIntelligence = async () => {
    try {
      const response = await fetch("/syllabus/intelligence");
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not load Syllabus Intelligence.");
      setIntelligence(data);
    } catch (loadError) {
      setError(loadError.message);
    }
  };

  useEffect(() => { loadIntelligence(); }, [refreshKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const analyzeSyllabus = async () => {
    if (!syllabusFile) return setError("Choose your complete syllabus first.");
    setBusy("syllabus"); setError(""); setNotice("");
    try {
      const formData = new FormData();
      formData.append("file", syllabusFile);
      const response = await fetch("/syllabus/analyze", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Syllabus analysis failed.");
      setPending(data);
      setSyllabusFile(null);
      if (syllabusInputRef.current) syllabusInputRef.current.value = "";
    } catch (analysisError) {
      setError(analysisError.message);
    } finally { setBusy(""); }
  };

  const confirmSyllabus = async () => {
    if (!pending?.analysisId) return;
    setBusy("confirm"); setError("");
    try {
      const response = await fetch("/syllabus/confirm", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ syllabusId: pending.analysisId }),
      });
      const data = await response.json();
      if (!response.ok) {
        if (data.missingSubjects?.length) setPending({ ...pending, missingSubjects: data.missingSubjects, canConfirm: false });
        throw new Error(data.error || "Syllabus confirmation failed.");
      }
      setPending(null); setReplaceMode(false); setNotice("Confirmed syllabus is now guiding Planify priority signals.");
      await loadIntelligence();
    } catch (confirmError) {
      setError(confirmError.message);
    } finally { setBusy(""); }
  };

  const analyzePyqs = async () => {
    if (pyqFiles.length === 0) return setError("Choose at least one previous-year paper.");
    setBusy("pyq"); setError(""); setNotice("");
    try {
      const formData = new FormData();
      pyqFiles.forEach((file) => formData.append("files", file));
      if (paperLabel.trim()) formData.append("label", paperLabel.trim());
      const response = await fetch("/syllabus/pyq", { method: "POST", body: formData });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "PYQ analysis failed.");
      setNotice(`${data.documentsAnalyzed} paper(s) analyzed; ${data.mappedTopics} confirmed topic mapping(s) added.`);
      setPyqFiles([]); setPaperLabel("");
      if (pyqInputRef.current) pyqInputRef.current.value = "";
      await loadIntelligence();
    } catch (analysisError) {
      setError(analysisError.message);
    } finally { setBusy(""); }
  };

  const removePyq = async (paper) => {
    if (!window.confirm(`Remove ${paper.label || paper.filename}? Its PYQ priority influence will be recalculated.`)) return;
    setBusy(`delete-${paper.pyqId}`); setError(""); setNotice("");
    try {
      const response = await fetch(`/syllabus/pyq/${paper.pyqId}`, { method: "DELETE" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not remove this PYQ paper.");
      setNotice("PYQ paper removed. Study-plan priorities were recalculated.");
      await loadIntelligence();
    } catch (removeError) {
      setError(removeError.message);
    } finally { setBusy(""); }
  };

  return (
    <section className="syllabus-intelligence" id="syllabus-setup" aria-label="Syllabus Intelligence">
      <div className="si-heading"><BrainCircuit size={16} /><span>Syllabus Intelligence</span></div>
      <p className="si-intro">Optional AI reference layer. Your existing subjects, topics and timetable stay unchanged.</p>
      {error && <div className="si-message error"><AlertTriangle size={14} />{error}</div>}
      {notice && <div className="si-message success"><CheckCircle2 size={14} />{notice}</div>}

      {(!intelligence?.configured || replaceMode) && !pending && (
        <div className="si-upload-block">
          <label className="si-file-label" htmlFor="syllabus-file"><FileUp size={14} /> {intelligence?.configured ? "Updated complete syllabus" : "Complete syllabus"}</label>
          <input id="syllabus-file" ref={syllabusInputRef} type="file" accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => {
            const files = Array.from(event.target.files || []);
            const validationError = invalidUploadMessage(files);
            setError(validationError);
            setSyllabusFile(validationError ? null : (files[0] || null));
          }} />
          <span className="si-file-name">{syllabusFile ? syllabusFile.name : "PDF, text, or clear image · max 10 MB"}</span>
          <button className="si-primary" type="button" onClick={analyzeSyllabus} disabled={busy === "syllabus"}>
            {busy === "syllabus" ? <><Loader size={14} className="spin-animation" /> Analysing…</> : <><Sparkles size={14} /> Analyse syllabus</>}
          </button>
          {intelligence?.configured && <button className="si-text-button" type="button" onClick={() => { setReplaceMode(false); setSyllabusFile(null); setError(""); }} disabled={busy}>Keep current syllabus</button>}
        </div>
      )}

      {pending && (
        <div className="si-review">
          <div className="si-status"><ShieldCheck size={15} /> Syllabus detected</div>
          <strong>{pending.summary.subjectCount} subjects · {pending.summary.topicCount} topics</strong>
          <div className="si-subject-list">{pending.summary.subjects.map((subject) => <span key={subject}>{subject}</span>)}</div>
          {pending.missingSubjects?.length > 0 && <div className="si-message error"><AlertTriangle size={14} />Current Planify subjects missing: {pending.missingSubjects.join(", ")}. Upload the complete syllabus that contains them.</div>}
          {pending.summary.uncertainties?.length > 0 && <p className="si-muted">Review recommended: {pending.summary.uncertainties[0]}</p>}
          <details className="si-details"><summary>Review extracted structure</summary>{pending.structure.subjects.map((subject) => <div key={subject.name}><b>{subject.name}</b>{subject.units.map((unit) => <div className="si-unit" key={unit.name}>{unit.name}: {unit.chapters.flatMap((chapter) => chapter.topics).join(", ")}</div>)}</div>)}</details>
          <button className="si-primary" type="button" onClick={confirmSyllabus} disabled={busy === "confirm" || pending.canConfirm === false}>
            {busy === "confirm" ? <><Loader size={14} className="spin-animation" /> Confirming…</> : <><CheckCircle2 size={14} /> Looks correct — confirm</>}
          </button>
          <button className="si-text-button" type="button" onClick={() => setPending(null)} disabled={busy}>Use a different file</button>
        </div>
      )}

      {intelligence?.configured && (
        <>
          <div className="si-confirmed"><ShieldCheck size={15} /><span><b>Confirmed:</b> {intelligence.summary.subjectCount} subjects · {intelligence.summary.topicCount} topics</span></div>
          {!replaceMode && <button className="si-text-button si-replace-button" type="button" onClick={() => { setReplaceMode(true); setError(""); setNotice(""); }}>Replace syllabus</button>}
          {intelligence.manualSubjects?.some((subject) => !subject.inSyllabus || subject.topics.some((topic) => !topic.inSyllabus)) && <div className="si-message warning"><AlertTriangle size={14} />Some entered topics are outside the confirmed syllabus. Planify keeps them, but marks them for your review.</div>}
          <div className="si-upload-block si-pyq-block">
            <label className="si-file-label" htmlFor="pyq-files"><FileQuestion size={14} /> Previous-year papers</label>
            <input id="pyq-files" ref={pyqInputRef} type="file" multiple accept=".pdf,.txt,.md,.csv,.png,.jpg,.jpeg,.webp" onChange={(event) => {
              const files = Array.from(event.target.files || []);
              const validationError = invalidUploadMessage(files, MAX_PYQ_FILES);
              setError(validationError);
              setPyqFiles(validationError ? [] : files);
            }} />
            <span className="si-file-name">{pyqFiles.length ? `${pyqFiles.length} paper(s) selected` : `Optional · up to ${MAX_PYQ_FILES} files · 10 MB each`}</span>
            <input className="si-label-input" value={paperLabel} maxLength="120" onChange={(event) => setPaperLabel(event.target.value)} placeholder="Optional label (e.g. AKTU 2025)" />
            <button className="si-secondary" type="button" onClick={analyzePyqs} disabled={busy === "pyq"}>
              {busy === "pyq" ? <><Loader size={14} className="spin-animation" /> Analysing…</> : <><Sparkles size={14} /> Analyse PYQs</>}
            </button>
          </div>
          {intelligence.prioritySignals?.length > 0 && <div className="si-insights"><b>PYQ priority insights</b>{intelligence.prioritySignals.slice(0, 5).map((item) => <div className="si-insight" key={item.syllabus_topic_id}><span>{item.topic_name}</span><small>{readablePriority(Number(item.priority_signal))} · {item.pyq_frequency} question match(es)</small></div>)}</div>}
          {intelligence.pyqDocuments?.length > 0 && <div className="si-insights"><b>Analysed PYQ papers</b>{intelligence.pyqDocuments.map((paper) => <div className="si-paper" key={paper.pyqId}><span><b>{paper.label || paper.filename}</b><small>{paper.mappingCount} confirmed topic match(es)</small></span><button type="button" className="si-icon-button" onClick={() => removePyq(paper)} disabled={busy === `delete-${paper.pyqId}`} aria-label={`Remove ${paper.label || paper.filename}`}><Trash2 size={14} /></button></div>)}</div>}
        </>
      )}
    </section>
  );
}

export default SyllabusIntelligence;
