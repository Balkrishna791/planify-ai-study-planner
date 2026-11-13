import React, { useEffect, useState } from "react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from "recharts";
import "./ChartBox.css";

const COLORS = ["#38bdf8", "#818cf8", "#f43f5e", "#fbbf24", "#10b981", "#6366f1"];

function ChartBox({ plan }) { //plan= props jo ki receive ho raha dusri file se
  const [themeColors, setThemeColors] = useState({ text: "#1e293b", grid: "#e2e8f0" });

  useEffect(() => {
    // Read actual computed CSS variables based on current theme
    const style = getComputedStyle(document.body);
    setThemeColors({
      text: style.getPropertyValue('--color-subtext').trim() || "#64748b",
      grid: style.getPropertyValue('--color-border').trim() || "#e2e8f0"
    });
  }, []);

  const data = plan.map(p => ({ name: p.name, hours: p.hours })); // used to declare variables that cannot be reassigned
  
  // BUG FIXED: Calculate actual average difficulty instead of hardcoding "Medium"
  const calculateAvgDifficulty = () => {
    if (!plan || plan.length === 0) return "N/A";
    const totalScore = plan.reduce((acc, p) => {
      const score = p.difficulty === "Hard" ? 3 : p.difficulty === "Medium" ? 2 : 1;
      return acc + (score * p.hours);
    }, 0);
    const totalHours = plan.reduce((s, p) => s + p.hours, 0);
    const avgScore = totalScore / totalHours;
    
    if (avgScore >= 2.5) return "Hard";
    if (avgScore >= 1.5) return "Medium";
    return "Easy";
  };

  const stats = {
    totalHours: plan.reduce((s, p) => s + p.hours, 0), //s = current sum(in starting 0) and p = current item
    avgDifficulty: calculateAvgDifficulty(),
    focus: plan.length > 0 ? plan[0].name : "None"
  };

  return (
    <div className="chart-container">
      <h3 className="chart-title">Academic Analytics</h3>
      
      <div className="stats-row">
        <div className="stat-card hover-scale">
          <span className="stat-label">Total Hours</span>
          <span className="stat-value">{stats.totalHours}h</span>
        </div>
        <div className="stat-card hover-scale">
          <span className="stat-label">Avg. Difficulty</span>
          <span className="stat-value">{stats.avgDifficulty}</span>
        </div>
        <div className="stat-card hover-scale">
          <span className="stat-label">Core Focus</span>
          <span className="stat-value">{stats.focus}</span>
        </div>
      </div>

      <div className="charts-grid">
        <div className="chart-item stagger-1">
          <p className="chart-label">Hour Allocation per Subject</p>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={data}>
              <XAxis dataKey="name" hide />
              <YAxis stroke={themeColors.text} tick={{ fill: themeColors.text }} />
              <Tooltip 
                cursor={{ fill: 'rgba(255,255,255,0.05)' }} 
                contentStyle={{ borderRadius: '12px', border: `1px solid ${themeColors.grid}`, background: 'var(--color-card-bg)', color: 'var(--color-text)' }}
              />
              <Bar dataKey="hours" fill="#38bdf8" radius={[10, 10, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="chart-item stagger-2">
          {/* %color repeat if neeeded */}
          <p className="chart-label">Subject Distribution (%)</p>
          <ResponsiveContainer width="100%" height={250}>
            <PieChart>
              <Pie data={data} dataKey="hours" nameKey="name" cx="50%" cy="50%" innerRadius={60} outerRadius={80} paddingAngle={5}>
                {data.map((entry, index) => <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />)}
              </Pie>
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: `1px solid ${themeColors.grid}`, background: 'var(--color-card-bg)', color: 'var(--color-text)' }}
              />
              <Legend verticalAlign="bottom" height={36} wrapperStyle={{ color: themeColors.text }}/>
            </PieChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

export default ChartBox;