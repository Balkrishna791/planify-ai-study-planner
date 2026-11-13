import React, { useState, useEffect } from "react";
import { LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { BarChart2, Clock, CheckCircle, TrendingUp, AlertCircle } from "lucide-react";
import "./Analytics.css";

function Analytics({ user }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const fetchAnalytics = async () => {
      try {
        const res = await fetch(`/analytics/${user.email}`);
        const result = await res.json();
        if (res.ok) {
          setData(result);
        } else {
          setError(result.error || "Failed to load analytics");
        }
      } catch (err) {
        setError("Network error. Please try again.");
      }
      setLoading(false);
    };

    if (user && user.email) {
      fetchAnalytics();
    }
  }, [user]);

  if (loading) {
    return (
      <div className="analytics-container fade-in">
        <div className="analytics-loading">
          <div className="spinner"></div>
          <p>Analyzing your study patterns...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="analytics-container fade-in">
        <div className="analytics-alert error"><AlertCircle size={20}/> {error}</div>
      </div>
    );
  }

  if (!data || data.daily.length === 0) {
    return (
      <div className="analytics-container fade-in">
        <div className="analytics-empty">
          <BarChart2 size={48} className="empty-icon" />
          <h2>No Data Yet</h2>
          <p>Start studying and generating plans to see your progress here.</p>
        </div>
      </div>
    );
  }

  // Formatting dates for x-axis
  const formattedData = data.daily.map(d => {
    const dateObj = new Date(d.date);
    return {
      ...d,
      displayDate: dateObj.toLocaleDateString('en-US', { weekday: 'short' }),
      fullDate: dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
    };
  });

  return (
    <div className="analytics-container fade-in">
      <div className="analytics-header">
        <div>
          <h2 className="analytics-title"><BarChart2 size={28} /> Performance Analytics</h2>
          <p className="analytics-subtitle">Track your study hours and task completion over time</p>
        </div>
      </div>

      <div className="analytics-stats-grid stagger-1">
        <div className="stat-card">
          <div className="stat-icon-wrapper"><Clock size={24} className="stat-icon clock" /></div>
          <div className="stat-info">
            <h3>{data.overall.completed_hours} hrs</h3>
            <p>Total Time Studied</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper"><CheckCircle size={24} className="stat-icon check" /></div>
          <div className="stat-info">
            <h3>{data.overall.percentage}%</h3>
            <p>Avg Completion Rate</p>
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-icon-wrapper"><TrendingUp size={24} className="stat-icon trend" /></div>
          <div className="stat-info">
            <h3>{formattedData.length > 0 ? formattedData[formattedData.length - 1].hours : 0} hrs</h3>
            <p>Latest Session</p>
          </div>
        </div>
      </div>

      <div className="charts-grid stagger-2">
        <div className="chart-card">
          <h3>Study Hours (Last 7 Days)</h3>
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="displayDate" stroke="var(--color-subtext)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-subtext)" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--color-card-bg)', borderColor: 'var(--color-border)', borderRadius: '8px', color: 'var(--color-text)' }}
                  labelStyle={{ color: 'var(--color-subtext)', fontWeight: 'bold', marginBottom: '5px' }}
                />
                <Line type="monotone" dataKey="hours" stroke="var(--color-accent)" strokeWidth={3} dot={{ r: 4, strokeWidth: 2 }} activeDot={{ r: 6 }} name="Hours Studied" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="chart-card">
          <h3>Tasks Completed (Last 7 Days)</h3>
          <div className="chart-wrapper">
            <ResponsiveContainer width="100%" height={300}>
              <BarChart data={formattedData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-border)" />
                <XAxis dataKey="displayDate" stroke="var(--color-subtext)" fontSize={12} tickLine={false} axisLine={false} />
                <YAxis stroke="var(--color-subtext)" fontSize={12} tickLine={false} axisLine={false} />
                <Tooltip 
                  contentStyle={{ backgroundColor: 'var(--color-card-bg)', borderColor: 'var(--color-border)', borderRadius: '8px', color: 'var(--color-text)' }}
                  cursor={{ fill: 'var(--color-focus-bg)' }}
                />
                <Bar dataKey="tasks" fill="#8b5cf6" radius={[4, 4, 0, 0]} name="Tasks Completed" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
}

export default Analytics;
