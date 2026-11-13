import React, { useState } from "react";
import { X, Plus } from "lucide-react";
import "./EditModal.css";

function EditModal({ subject, subjects = [], onSave, onCancel }) {
  const [name, setName] = useState(subject.name);
  const [examDate, setExamDate] = useState(subject.examDate);
  const [difficulty, setDifficulty] = useState(subject.difficulty);
  const [topics, setTopics] = useState(subject.topics || [{ id: Date.now(), name: "" }]);
  
  const [isClosing, setIsClosing] = useState(false);
  const [error, setError] = useState("");

  const updateTopic = (id, val) => {
    setTopics(topics.map(t => t.id === id ? { ...t, name: val } : t));
  };

  const addTopic = () => setTopics([...topics, { id: Date.now(), name: "" }]);
  const removeTopic = (id) => topics.length > 1 && setTopics(topics.filter(t => t.id !== id));

  const today = new Date();
  const minDate = today.toISOString().split("T")[0];
  const currentYear = today.getFullYear();
  const maxDate = `${currentYear + 10}-12-31`;

  const handleClose = () => {
    setIsClosing(true);
    setTimeout(onCancel, 300); // Wait for animation
  };

  const handleSave = async () => {
    setError("");
    if (!name || !name.trim()) return setError("Subject name is required.");
    if (subjects.some((item, index) => index !== subject.index && item.name.trim().toLowerCase() === name.trim().toLowerCase())) {
      return setError("This subject already exists. Choose a different name.");
    }
    if (!examDate) return setError("Please select an exam date.");
    if (examDate < minDate || examDate > maxDate) {
      return setError("Invalid Date! Please select a date between today and the next 10 years.");
    }
    const validTopics = topics.filter(t => t.name.trim() !== "");
    if (validTopics.length === 0) return setError("Add at least one topic.");
    const normalizedTopics = validTopics.map(topic => topic.name.trim().toLowerCase());
    if (new Set(normalizedTopics).size !== normalizedTopics.length) {
      return setError("Duplicate topic names are not allowed.");
    }
    
    const wasSaved = await onSave({ ...subject, name: name.trim(), examDate, difficulty, topics: validTopics });
    if (!wasSaved) {
      return setError("Changes could not be saved. Please check the values and try again.");
    }
    setIsClosing(true);
    setTimeout(onCancel, 300);
  };

  return (
    <div className={`edit-overlay ${isClosing ? 'fade-out' : 'fade-in'}`}>
      <div className={`edit-modal ${isClosing ? 'scale-out' : 'scale-in'}`}>
        <h3 className="edit-title">Edit Subject Parameters</h3>
        
        {error && <div className="edit-error slide-up">{error}</div>}

        <div className="edit-form">
          <div className="edit-group">
            <label className="edit-label">SUBJECT NAME</label>
            <input 
              className="edit-input" 
              value={name} 
              onChange={e => setName(e.target.value)} 
            />
          </div>

          <div className="edit-group">
            <label className="edit-label">EXAM DATE</label>
            <input 
              type="date" 
              className="edit-input" 
              value={examDate} 
              min={minDate} 
              max={maxDate} 
              onChange={e => setExamDate(e.target.value)} 
            />
          </div>

          <div className="edit-group">
            <label className="edit-label">DIFFICULTY LEVEL</label>
            <select 
              className="edit-input" 
              value={difficulty} 
              onChange={e => setDifficulty(e.target.value)}
            >
              <option>Easy</option>
              <option>Medium</option>
              <option>Hard</option>
            </select>
          </div>

          <div className="edit-topic-area">
            <label className="edit-label">MANAGE TOPICS</label>
            {topics.map(t => (
              <div key={t.id} className="edit-topic-row slide-up">
                <input 
                  className="edit-topic-input" 
                  value={t.name} 
                  onChange={e => updateTopic(t.id, e.target.value)} 
                />
                <button onClick={() => removeTopic(t.id)} className="edit-del-btn" aria-label="Remove Topic">
                  <X size={16}/>
                </button>
              </div>
            ))}
            <button onClick={addTopic} className="edit-add-btn hover-scale">
              <Plus size={14}/> Add Topic
            </button>
          </div>
        </div>

        <div className="edit-actions">
          <button onClick={handleClose} className="edit-cancel-btn">Cancel</button>
          <button onClick={handleSave} className="edit-save-btn hover-scale">Save Changes</button>
        </div>
      </div>
    </div>
  );
}

export default EditModal;
