import React, { useState } from "react";
import { User, GraduationCap, Lock, Save, AlertCircle, CheckCircle, Mail, Download, Trash2 } from "lucide-react";
import "./Profile.css";

function Profile({ user, setUser, onAccountDeleted }) {
  const [name, setName] = useState(user?.name || "");
  const [educationLevel, setEducationLevel] = useState(user?.education_level || "");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [showDeleteControls, setShowDeleteControls] = useState(false);
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setLoading(true);
    setMessage(null);
    setError(null);

    if (!name.trim() || !/[a-zA-Z]{2,}/.test(name)) {
      setError("Please enter a valid name with at least two letters.");
      setLoading(false);
      return;
    }
    if (password) {
      const passwordPattern = /^(?=.*\d)(?=.*[A-Z])(?=.*[a-z])(?=.*[@#$%^&+=!_]).{8,128}$/;
      if (!passwordPattern.test(password)) {
        setError("Password must be 8-128 characters with uppercase, lowercase, number, and special character.");
        setLoading(false);
        return;
      }
      if (!currentPassword) {
        setError("Enter your current password before setting a new password.");
        setLoading(false);
        return;
      }
    }

    try {
      const res = await fetch("/update-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, education_level: educationLevel, password, currentPassword })
      });
      const data = await res.json();

      if (res.ok) {
        setMessage("Profile updated successfully!");
        const updatedUser = { ...user, name: data.name, education_level: data.education_level, ...(data.token ? { token: data.token } : {}) };
        localStorage.setItem("user", JSON.stringify(updatedUser));
        if (setUser) setUser(updatedUser);
        setCurrentPassword("");
        setPassword(""); // Clear password field
      } else {
        setError(data.error || "Failed to update profile");
      }
    } catch (err) {
      setError("Network error. Please try again later.");
    }
    setLoading(false);
  };

  const handleExport = async () => {
    setExporting(true);
    setMessage(null);
    setError(null);
    try {
      const response = await fetch("/account/export");
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || "Your data export could not be prepared.");
      }
      const blob = await response.blob();
      const downloadUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = "planify-account-data.json";
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(downloadUrl);
      setMessage("Your account data download has started.");
    } catch (err) {
      setError(err.message || "Network error. Please try again later.");
    } finally {
      setExporting(false);
    }
  };

  const handleDeleteAccount = async () => {
    setMessage(null);
    setError(null);
    if (deleteConfirmation !== "DELETE") {
      setError('Type DELETE exactly to confirm permanent account removal.');
      return;
    }
    if (!deletePassword) {
      setError("Enter your current password to delete your account.");
      return;
    }
    if (!window.confirm("This permanently deletes your Planify account and all saved study data. Continue?")) return;

    setDeleting(true);
    try {
      const response = await fetch("/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation: deleteConfirmation, currentPassword: deletePassword })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Account deletion failed.");
      localStorage.removeItem(`planify:sleepHours:${user.email.toLowerCase()}`);
      localStorage.removeItem("user");
      onAccountDeleted?.();
    } catch (err) {
      setError(err.message || "Network error. Please try again later.");
      setDeleting(false);
    }
  };

  return (
    <div className="profile-container fade-in">
      <div className="profile-header">
        <div className="profile-avatar">
           <User size={48} className="avatar-icon" />
        </div>
        <div className="profile-title">
          <h2>Your Profile</h2>
          <p>Manage your account settings and target goals</p>
        </div>
      </div>

      <div className="profile-card">
        {message && <div className="profile-alert success slide-up"><CheckCircle size={18} /> {message}</div>}
        {error && <div className="profile-alert error slide-up"><AlertCircle size={18} /> {error}</div>}

        <div className="form-group stagger-1">
          <label>Full Name</label>
          <div className="profile-input-group">
            <User size={18} className="input-icon" />
            <input 
              type="text" 
              className="profile-input"
              value={name} 
              onChange={e => setName(e.target.value)} 
              placeholder="Full Name" 
            />
          </div>
        </div>

        <div className="form-group stagger-2">
          <label>Email Address</label>
          <div className="profile-input-group disabled">
            <Mail size={18} className="input-icon" />
            <input 
              type="email" 
              className="profile-input"
              value={user?.email || ""} 
              disabled 
            />
          </div>
        </div>

        <div className="form-group stagger-3">
          <label>Target Goal / Education Level</label>
          <div className="profile-input-group">
            <GraduationCap size={18} className="input-icon" />
            <input 
              type="text" 
              className="profile-input"
              value={educationLevel} 
              onChange={e => setEducationLevel(e.target.value)} 
              placeholder="Class 12, JEE, B.Tech, etc." 
            />
          </div>
        </div>

        <div className="form-group stagger-4">
          <label>New Password (Optional)</label>
          <div className="profile-input-group">
            <Lock size={18} className="input-icon" />
            <input 
              type="password" 
              className="profile-input"
              value={password} 
              onChange={e => setPassword(e.target.value)} 
              placeholder="Leave blank to keep current password" 
              autoComplete="new-password"
            />
          </div>
        </div>

        {password && <div className="form-group stagger-4">
          <label>Current Password</label>
          <div className="profile-input-group">
            <Lock size={18} className="input-icon" />
            <input
              type="password"
              className="profile-input"
              value={currentPassword}
              onChange={e => setCurrentPassword(e.target.value)}
              placeholder="Required to change password"
              autoComplete="current-password"
            />
          </div>
        </div>}

        <button className="profile-save-btn hover-scale stagger-5" onClick={handleSave} disabled={loading}>
          <Save size={18} /> {loading ? "Saving..." : "Save Changes"}
        </button>

        <section className="account-data-section" aria-labelledby="account-data-heading">
          <h3 id="account-data-heading">Your data</h3>
          <p>Download the profile and study data stored in Planify. Passwords, sign-in tokens, and API keys are never included.</p>
          <button className="profile-secondary-btn" onClick={handleExport} disabled={exporting}>
            <Download size={18} /> {exporting ? "Preparing download…" : "Download my data"}
          </button>
        </section>

        <section className="account-delete-section" aria-labelledby="delete-account-heading">
          <h3 id="delete-account-heading">Delete account</h3>
          <p>This permanently deletes your profile, syllabus analysis, PYQ analysis, plans, and progress. This cannot be undone.</p>
          {!showDeleteControls ? (
            <button className="profile-delete-btn" onClick={() => setShowDeleteControls(true)}>
              <Trash2 size={18} /> Delete my account
            </button>
          ) : (
            <div className="delete-confirmation-controls">
              <label>Current password</label>
              <input
                type="password"
                className="profile-input"
                value={deletePassword}
                onChange={event => setDeletePassword(event.target.value)}
                autoComplete="current-password"
              />
              <label>Type <strong>DELETE</strong> to confirm</label>
              <input
                type="text"
                className="profile-input"
                value={deleteConfirmation}
                onChange={event => setDeleteConfirmation(event.target.value)}
                autoComplete="off"
              />
              <div className="delete-actions">
                <button className="profile-delete-btn" onClick={handleDeleteAccount} disabled={deleting}>
                  <Trash2 size={18} /> {deleting ? "Deleting…" : "Delete permanently"}
                </button>
                <button className="profile-cancel-btn" onClick={() => {
                  setShowDeleteControls(false);
                  setDeletePassword("");
                  setDeleteConfirmation("");
                }} disabled={deleting}>Cancel</button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default Profile;
