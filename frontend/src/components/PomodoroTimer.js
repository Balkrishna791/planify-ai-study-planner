import React, { useState, useEffect } from "react";
import { Play, Pause, RotateCcw } from "lucide-react";
import { NotificationService } from "../services/NotificationService";
import "./PomodoroTimer.css";

function PomodoroTimer({ resetTrigger }) {
  const [minutes, setMinutes] = useState(25);
  // BUG FIXED: Initialized seconds properly from minutes
  const [seconds, setSeconds] = useState(25 * 60);
  const [isActive, setIsActive] = useState(false);

  // Quick settings
  const presets = [
    { label: "25m", value: 25 },
    { label: "5m", value: 5 },
    { label: "15m", value: 15 }
  ];

  useEffect(() => {
    if (resetTrigger > 0) {
      setIsActive(false);
      setMinutes(0);
      setSeconds(0);
    }
  }, [resetTrigger]);

  // Sync remaining seconds when custom minutes change (only when timer is inactive)
  useEffect(() => {
    if (!isActive) {
      const parsedMins = parseInt(minutes) || 0;
      setSeconds(parsedMins * 60);
    }
  }, [minutes, isActive]);

  // Main countdown hook
  useEffect(() => {
    let interval = null;
    if (isActive && seconds > 0) {
      interval = setInterval(() => setSeconds(s => s - 1), 1000);
    } else if (seconds === 0 && isActive) {
      setIsActive(false);
      NotificationService.send("Focus Session Complete! 🎯", "Well done! Time for a short break.");
    }
    return () => clearInterval(interval);
  }, [isActive, seconds]);

  const adjustMinutes = (amount) => {
    if (isActive) return;
    setMinutes(prev => {
      const current = prev === "" ? 25 : parseInt(prev);
      return Math.max(0, current + amount);
    });
  };

  const applyPreset = (val) => {
    if (isActive) return;
    setMinutes(val);
  };

  const format = (s) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  // Circular progress math
  const totalSeconds = (parseInt(minutes) || 0) * 60;
  const progress = totalSeconds > 0 ? ((totalSeconds - seconds) / totalSeconds) * 100 : 0;
  const circleRadius = 54;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const strokeDashoffset = circleCircumference - (progress / 100) * circleCircumference;

  return (
    <div className="pomo-container">
      <div className={`pomo-ring-wrapper ${isActive ? 'active' : ''}`}>
        <svg className="pomo-svg" viewBox="0 0 120 120">
          <circle 
            className="pomo-bg" 
            cx="60" cy="60" r={circleRadius} 
          />
          <circle 
            className="pomo-progress" 
            cx="60" cy="60" r={circleRadius} 
            strokeDasharray={circleCircumference}
            strokeDashoffset={strokeDashoffset}
          />
        </svg>
        <div className="pomo-timer-text">{format(seconds)}</div>
      </div>

      {!isActive ? (
        <>
          <div className="pomo-presets">
            {presets.map(p => (
              <button 
                key={p.value} 
                onClick={() => applyPreset(p.value)}
                className={`pomo-preset-btn ${minutes === p.value ? 'active' : ''}`}
              >
                {p.label}
              </button>
            ))}
          </div>
          
          <div className="pomo-config">
            <button className="pomo-adj-btn" onClick={() => adjustMinutes(-5)} aria-label="Decrease 5 minutes">-5</button>
            <input
              type="number"
              min="1" max="180"
              value={minutes}
              onChange={(e) => {
                const val = e.target.value;
                setMinutes(val === "" ? "" : Math.max(0, parseInt(val) || 0));
              }}
              onBlur={() => {
                if (minutes === "") setMinutes(0);
              }}
              className="pomo-input"
            />
            <button className="pomo-adj-btn" onClick={() => adjustMinutes(5)} aria-label="Increase 5 minutes">+5</button>
          </div>
        </>
      ) : (
        <div className="pomo-status">Focusing... ⚡</div>
      )}

      <div className="pomo-controls">
        <button 
          className={`pomo-btn main-btn ${isActive ? 'pause' : 'start'} hover-scale`}
          onClick={() => {
            if (minutes === "" || minutes < 1) setMinutes(25);
            setIsActive(!isActive);
          }}
        >
          {isActive ? <><Pause size={16}/> Pause</> : <><Play size={16}/> Start</>}
        </button>
        <button 
          className="pomo-btn reset-btn" 
          onClick={() => { 
            setIsActive(false); 
            setMinutes(0);
            setSeconds(0); 
          }}
          aria-label="Reset Timer"
        >
          <RotateCcw size={16}/>
        </button>
      </div>
    </div>
  );
}

export default PomodoroTimer;
