import React, { useState, useEffect, useCallback } from "react";
import { Brain, CheckCircle, ChevronRight } from "lucide-react";
import "./SpacedRepetition.css";

/*
  SpacedRepetition.js
  Implements the SuperMemo-2 (SM-2) algorithm for long-term memory retention.
*/

export function localDateISO(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function SpacedRepetition({ user }) {
  const [reviews, setReviews] = useState([]);
  const [upcomingReviews, setUpcomingReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentReview, setCurrentReview] = useState(null);
  const [showAnswer, setShowAnswer] = useState(false);
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  // Fetch today's due reviews
  const fetchReviews = useCallback(async () => {
    if (!user) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/get-reviews/${user.email}`);
      const data = await res.json().catch(() => null);
      if (!res.ok || !Array.isArray(data)) {
        throw new Error(data?.error || "Unable to load your review queue.");
      }
      
      const today = localDateISO(new Date());
      const due = data.filter(r => r.next_review_date <= today);
      const upcoming = data.filter(r => r.next_review_date > today);
      
      setReviews(due);
      setUpcomingReviews(upcoming);
      if (due.length > 0) setCurrentReview(due[0]);
      setLoading(false);
    } catch (e) {
      console.error("Error fetching reviews:", e);
      setReviews([]);
      setUpcomingReviews([]);
      setCurrentReview(null);
      setError(e.message || "Unable to load your review queue. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    fetchReviews();
  }, [fetchReviews]);

  // Handle rating a card (1-5 stars)
  const handleRating = async (rating) => {
    if (!currentReview || !user || isSaving) return;

    // SM-2 Algorithm logic
    let ease = currentReview.ease_factor || 2.5;
    let interval = currentReview.interval || 1;
    
    // Adjust ease factor based on rating (1-5)
    // Formula: EF' = EF + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02))
    ease = ease + (0.1 - (5 - rating) * (0.08 + (5 - rating) * 0.02));
    if (ease < 1.3) ease = 1.3; // minimum ease

    // Calculate next interval
    if (rating < 3) {
      interval = 1; // Failed, reset interval
    } else if (interval === 1) {
      interval = 3;
    } else {
      interval = Math.round(interval * ease);
    }

    // Next date
    const nextDate = new Date();
    nextDate.setDate(nextDate.getDate() + interval);
    const nextDateStr = localDateISO(nextDate);

    // Save to backend
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch("/save-review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: user.email,
          topic_name: currentReview.topic_name,
          next_review_date: nextDateStr,
          interval: interval,
          ease_factor: ease
        })
      });
      const data = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(data?.error || "Unable to save this review.");
      }
      
      // Move to next card
      const remaining = reviews.filter(r => r.topic_name !== currentReview.topic_name);
      setReviews(remaining);
      setCurrentReview(remaining.length > 0 ? remaining[0] : null);
      setShowAnswer(false);

    } catch (e) {
      console.error("Error saving review:", e);
      setError(e.message || "Unable to save this review. Please try again.");
    } finally {
      setIsSaving(false);
    }
  };

  if (loading) return <div className="sr-loading">Loading Review Queue...</div>;

  return (
    <div className="sr-container fade-in">
      <div className="sr-header">
        <div className="sr-title-wrap">
          <Brain size={28} className="sr-icon" />
          <div>
            <h2>Spaced Repetition</h2>
            <p>Review these topics today to commit them to long-term memory.</p>
          </div>
        </div>
        <div className="sr-badge">
          {reviews.length} {reviews.length === 1 ? 'Topic' : 'Topics'} Due
        </div>
      </div>

      {error && (
        <div className="sr-error" role="alert">
          {error} <button type="button" onClick={fetchReviews}>Retry</button>
        </div>
      )}

      {!currentReview ? (
        <div className="sr-empty">
          <CheckCircle size={64} color="var(--color-success)" />
          <h3>All caught up!</h3>
          <p>You've completed all your reviews for today. Your brain is growing stronger.</p>
          
          {upcomingReviews.length > 0 && (
            <div className="upcoming-reviews-section">
              <h4>📅 Scheduled Reviews ({upcomingReviews.length})</h4>
              <div className="upcoming-list">
                {upcomingReviews.map((r, i) => (
                  <div key={i} className="upcoming-item">
                    <span className="upcoming-topic">{r.topic_name}</span>
                    <span className="upcoming-date">
                      Due: {new Date(r.next_review_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="flashcard-container">
          <div className={`flashcard ${showAnswer ? 'flipped' : ''}`}>
            <div className="flashcard-front">
              <span className="card-label">Topic to Recall</span>
              <h3>{currentReview.topic_name}</h3>
              <button className="reveal-btn hover-scale" onClick={() => setShowAnswer(true)}>
                Reveal Answer / Next <ChevronRight size={16} />
              </button>
            </div>
            
            <div className="flashcard-back">
              <h3>{currentReview.topic_name}</h3>
              <p className="card-instruction">How well did you remember this?</p>
              
              <div className="rating-buttons">
                <button className="rate-btn hard" onClick={() => handleRating(1)} disabled={isSaving}>
                  <div className="rate-emoji">🤯</div>
                  <span>Forgot Completely</span>
                  <small>Review Tomorrow</small>
                </button>
                
                <button className="rate-btn medium" onClick={() => handleRating(3)} disabled={isSaving}>
                  <div className="rate-emoji">🤔</div>
                  <span>Hard to Remember</span>
                  <small>Review in 3 days</small>
                </button>
                
                <button className="rate-btn easy" onClick={() => handleRating(5)} disabled={isSaving}>
                  <div className="rate-emoji">😎</div>
                  <span>Perfectly Recalled</span>
                  <small>Review later</small>
                </button>
              </div>
            </div>
          </div>
          
          <div className="progress-indicator">
            {isSaving ? "Saving your review..." : `${reviews.length} remaining in today's queue`}
          </div>
        </div>
      )}
    </div>
  );
}

export default SpacedRepetition;
