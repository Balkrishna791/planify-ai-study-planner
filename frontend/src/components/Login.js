import React, { useState } from "react";
import { BookOpen, User, Mail, Lock, ArrowRight, ShieldCheck, GraduationCap } from "lucide-react";
import "./Login.css";

function Login({ onLogin, initialMode = "login", onBack }) {
  const [isRegister, setIsRegister] = useState(initialMode === "register");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [educationLevel, setEducationLevel] = useState("");
  const [error, setError] = useState("");

  const handleSubmit = async () => {
    setError(""); // Reset error state
    if (isRegister && !name) return setError("Please enter your name.");
    if (isRegister && !/[a-zA-Z]{2,}/.test(name)) return setError("Name must contain at least 2 letters.");
    if (isRegister && !educationLevel.trim()) return setError("Please enter your Target Goal / Education Level.");
    if (!email || !password) return setError("All fields are required.");

    const emailLower = email.trim().toLowerCase();
    if (!/^[a-zA-Z0-9.-]*[a-zA-Z][a-zA-Z0-9.-]*@[\w.-]+\.\w+$/.test(emailLower)) {
      return setError("Valid email required (e.g., user@domain.com)");
    }

    if (isRegister) {
      const passRegex = /^(?=.*\d)(?=.*[A-Z])(?=.*[a-z])(?=.*[@#$%^&+=!_]).{8,128}$/;
      if (!passRegex.test(password)) {
        return setError("Password: 8-128 chars, 1 uppercase, 1 lowercase, 1 number, 1 special char (@, #, $).");
      }
    }

    const endpoint = isRegister ? "/register" : "/login";
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          email: emailLower, 
          password, 
          name: name.trim(),
          education_level: isRegister ? educationLevel.trim() : ""
        })
      });
      const data = await res.json();
      if (res.ok) {
        if (!isRegister) {
          localStorage.setItem("user", JSON.stringify(data)); /*save reh sakta even refresh ke baad.*/
          onLogin(data);
        } else {
          alert("Registration Successful! Please Login.");
          setIsRegister(false);
          setEmail("");
          setPassword("");
          setName("");
          setEducationLevel("");
        }
      } else setError(data.error || "Authentication Failed");
    } catch (err) {
      setError("Server Connection Error");
    }
  };

  const getPasswordStrength = (pass) => {
    if (!pass) return 0;
    let score = 0;
    if (pass.length >= 8) score += 1;
    if (/[A-Z]/.test(pass)) score += 1;
    if (/[a-z]/.test(pass)) score += 1;
    if (/[0-9]/.test(pass)) score += 1;
    if (/[@#$%^&+=!_]/.test(pass)) score += 1;
    return score; // Max 5
  };

  const strength = getPasswordStrength(password);

  return (
    <div className="login-container">
      <div className="login-left">
        <div className="login-brand-box scale-in">
          <h1 className="login-logo">
            <BookOpen size={48} className="logo-icon" /> Planify
          </h1>
          <p className="login-tag">Modern AI Study Architecture</p>
          <ul className="login-list">
            <li className="stagger-1"><ShieldCheck size={18}/> Smart Adaptive Planning</li>
            <li className="stagger-2"><ShieldCheck size={18}/> Focus Optimization</li>
            <li className="stagger-3"><ShieldCheck size={18}/> Real-time Progress Tracking</li>
          </ul>
        </div>
        <div className="floating-shape shape-1"></div>
        <div className="floating-shape shape-2"></div>
      </div>

      <div className="login-right">
        <div className="login-card fade-in">
          {onBack && <button className="login-link login-back" type="button" onClick={onBack}>← Back to Planify</button>}
          <h2 className="login-title">{isRegister ? "Create Account" : "Access Portal"}</h2>
          
          {error && <div className="login-error slide-up">{error}</div>}

          <div className={`form-wrapper ${isRegister ? "register-mode" : "login-mode"}`}>
            {isRegister && (
              <>
                <div className="input-group slide-up">
                  <User size={18} className="input-icon" />
                  <input 
                    className="login-input" 
                    placeholder="Full Name" 
                    value={name} 
                    onChange={e => setName(e.target.value)} 
                  />
                </div>
                <div className="input-group slide-up">
                  <GraduationCap size={18} className="input-icon" />
                  <input 
                    className="login-input" 
                    placeholder="Target Goal / Grade (e.g. Class 12, B.Tech, JEE)" 
                    value={educationLevel} 
                    onChange={e => setEducationLevel(e.target.value)} 
                  />
                </div>
              </>
            )}
            
            <div className="input-group stagger-1">
              <Mail size={18} className="input-icon" />
              <input 
                className="login-input" 
                placeholder="Email Address" 
                value={email} 
                onChange={e => setEmail(e.target.value)} 
              />
            </div>
            
            <div className="input-group stagger-2">
              <Lock size={18} className="input-icon" />
              <input 
                className="login-input" 
                type="password" 
                placeholder="Password" 
                value={password} 
                onChange={e => setPassword(e.target.value)} 
              />
            </div>

            {isRegister && (
              <div className="password-strength-container stagger-3">
                <div className="strength-bar">
                  <div 
                    className={`strength-fill strength-${strength}`} 
                    style={{ width: `${(strength / 5) * 100}%` }}
                  ></div>
                </div>
                <span className="strength-text">
                  {strength < 2 ? "Weak" : strength < 4 ? "Medium" : "Strong"}
                </span>
              </div>
            )}
          </div>
          
          <button className="login-btn hover-scale stagger-4" onClick={handleSubmit}>
            {isRegister ? "Initialize Account" : "Secure Login"} <ArrowRight size={18} />
          </button>
          
          <p className="login-switch stagger-5">
            {isRegister ? "Existing member? " : "New here? "}
            <span className="login-link" onClick={() => { setIsRegister(!isRegister); setError(""); }}>
              {isRegister ? "Login" : "Register Now"}
            </span>
          </p>

        </div>
      </div>
    </div>
  );
}

export default Login;
