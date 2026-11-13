import React, { useState } from "react";
import { Plus, X, List, Loader, AlertTriangle } from "lucide-react";
import "./AddSubject.css";

// ── Layer 1: Frontend Regex Validation ──────────────────────────────────────
// Catches obvious gibberish before it even hits the backend.
const isValidAcademicText = (text) => {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;

  // Allow known abbreviations and programming terms (case-insensitive)
  const knownTerms = /^(c\+\+|c#|c|r|go|os|ai|ml|dl|nlp|sql|css|html|js|ts|dsa|oop|dbms|cn|se|it|iot|ar|vr|ui|ux|api|sdk|jvm|tcp|ip|http|dns|ftp|ssh|php|jwt|mvc|mvp|mvvm|rest|crud|nosql|graphql|aws|gcp|seo|erp|crm|hci|vlsi|cad|cam|plc|emi|emc|pcb|bios|rom|ram|gpu|cpu|ssd|hdd|lan|wan|vpn|xml|json|yaml|ci|cd)$/i;
  if (knownTerms.test(trimmed)) return true;

  // Must contain at least one alphabetic character
  if (!/[a-zA-Z]/.test(trimmed)) return false;

  // For strings longer than 3 characters, must contain at least one vowel
  if (trimmed.length > 3 && !/[aeiouAEIOU]/.test(trimmed)) return false;

  // Must not be all same character repeated (e.g., "aaaa", "xxx")
  if (/^(.)\1+$/.test(trimmed)) return false;

  return true;
};

function AddSubject({ onAdd, subjects = [] }) {/*New subject ko App.js me bhejna.*/
  // BUG FIXED: useState("Medium","Easy","Hard") was invalid.
  const [name, setName] = useState("");/*const [value, setValue]*/
  const [examDate, setExamDate] = useState("");
  const [difficulty, setDifficulty] = useState("Medium");
  const [topics, setTopics] = useState([{ id: Date.now(), name: "" }]);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);
  const [validating, setValidating] = useState(false);

  const addTopicField = () => {
    setTopics([...topics, { id: Date.now(), name: "" }]);
  };

  const updateTopic = (id, val) => {
    setTopics(topics.map(t => t.id === id ? { ...t, name: val } : t/*else same topic return*/));
  };

  const removeTopic = (id) => {
    if (topics.length > 1)/*At least: 1 topic field rehna chahiye.*/ {
      setTopics(topics.filter(t => t.id !== id));
    }
  };

  const today = new Date();
  const minDate = today.toISOString().split("T")[0];
  const currentYear = today.getFullYear();
  const maxDate = `${currentYear + 10}-12-31`;

  const handleSubmit = async () => {
    setError("");
    if (!name || !examDate) return setError("Subject and Date are required");
    if (subjects.some(subject => subject.name.trim().toLowerCase() === name.trim().toLowerCase())) {
      return setError("This subject already exists. Edit the existing subject instead.");
    }
    
    if (examDate < minDate || examDate > maxDate) {
      return setError("Invalid Date! Please select a date between today and the next 10 years.");
    }

    const validTopics = topics.filter(t => t.name.trim() !== "");
    if (validTopics.length === 0) return setError("Add at least one topic");
    const normalizedTopics = validTopics.map(topic => topic.name.trim().toLowerCase());
    if (new Set(normalizedTopics).size !== normalizedTopics.length) {
      return setError("Duplicate topic names are not allowed within a subject.");
    }
    
    // ── Layer 1: Frontend Regex Validation ──
    const regexIssues = [];
    if (!isValidAcademicText(name)) {
      regexIssues.push(`"${name}"`);
    }
    validTopics.forEach(t => {
      if (!isValidAcademicText(t.name.trim())) {
        regexIssues.push(`"${t.name.trim()}"`);
      }
    });
    
    if (regexIssues.length > 0) {
      return setError(`These don't look like real academic terms: ${regexIssues.join(", ")}. Please enter valid subject/topic names.`);
    }
    
    // ── Layer 2: AI-Powered Subject/Topic Validation ──
    setValidating(true);
    try {
      const res = await fetch("/validate-subjects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          subjects: [{ name, topics: validTopics.map(t => ({ name: t.name.trim() })) }]
        })
      });
      const data = await res.json();
      
      if (!data.valid && data.invalidItems && data.invalidItems.length > 0) {
        const details = data.invalidItems.map(i => {
          let msg = `"${i.name}"`;
          if (i.suggestion) msg += ` — ${i.suggestion}`;
          return msg;
        }).join(", ");
        setValidating(false);
        return setError(`These don't appear to be real academic subjects/topics: ${details}. Please enter subjects and topics from real educational curricula.`);
      }
    } catch (e) {
      // Graceful degradation — if validation API fails (network/quota), proceed anyway
      console.warn("AI subject validation skipped (network/quota issue):", e);
    }
    setValidating(false);
    
    // ── All validations passed — proceed with adding ──
    const wasSaved = await onAdd({ name: name.trim(), examDate, difficulty, topics: validTopics });
    if (!wasSaved) {
      return setError("The subject could not be saved. Please correct it and try again.");
    }
    
    // Reset form and show success state
    setName("");
    setExamDate("");
    setDifficulty("Medium");
    setTopics([{ id: Date.now(), name: "" }]);
    
    setSuccess(true);
    setTimeout(() => setSuccess(false), 2000);
  };

  return (
    <div className="addsub-container" id="curriculum-setup">
      <h3 className="addsub-label">New Curriculum</h3>
      
      {error && (
        <div className="addsub-error slide-up">
          <AlertTriangle size={14} style={{ flexShrink: 0, marginTop: "2px" }} />
          <span>{error}</span>
        </div>
      )}
      
      <input 
        className="addsub-input" 
        placeholder="Subject (e.g. Physics)" 
        value={name} 
        onChange={e => setName(e.target.value)} 
        disabled={validating}
      />
      <input 
        className="addsub-input" 
        type="date" 
        value={examDate} 
        min={minDate} 
        max={maxDate} 
        onChange={e => setExamDate(e.target.value)} 
        disabled={validating}
      />
      <select 
        className="addsub-input" 
        value={difficulty} 
        onChange={e => setDifficulty(e.target.value)}
        disabled={validating}
      >
        <option>Easy</option>
        <option>Medium</option>
        <option>Hard</option>
      </select>

      <div className="addsub-topic-section">
        <span className="addsub-topic-label"><List size={12}/> Topics to Cover</span>
        {topics.map((topic, idx) => (
          <div key={topic.id} className="addsub-topic-row slide-up">
            <input 
              className="addsub-topic-input" 
              placeholder={`Topic ${idx + 1}`} 
              value={topic.name} 
              onChange={e => updateTopic(topic.id, e.target.value)} 
              disabled={validating}
            />
            {topics.length > 1 && (
              <button onClick={() => removeTopic(topic.id)} className="addsub-remove-btn" aria-label="Remove Topic" disabled={validating}>
                <X size={14} />
              </button>
            )}
          </div>
        ))}
        <button onClick={addTopicField} className="addsub-add-topic-btn hover-scale" disabled={validating}>
          <Plus size={12}/> Add Topic
        </button>
      </div>

      <button 
        className={`addsub-submit-btn hover-scale ${success ? 'success' : ''} ${validating ? 'validating' : ''}`} 
        onClick={handleSubmit}
        disabled={validating}
      >
        {validating ? (
          <>
            <Loader size={16} className="spin-animation" /> Verifying Topics...
          </>
        ) : success ? "Plan Created! ✓" : "Create Subject Plan"}
      </button>
    </div>
  );
}

export default AddSubject;
