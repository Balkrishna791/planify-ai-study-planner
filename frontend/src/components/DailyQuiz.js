import React, { useState, useEffect, useRef } from "react";
import { Brain, Star, CheckCircle, XCircle, ArrowRight, Zap, Trophy } from "lucide-react";
import "./DailyQuiz.css";

/*
  DailyQuiz.js
  Immersive Kahoot/Duolingo-style Quiz for Daily Knowledge Check.
*/

function DailyQuiz({ user, todaySubjects, sleepHours, onComplete, onExit }) {
  const [questions, setQuestions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [isQuotaError, setIsQuotaError] = useState(false);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [selectedAnswer, setSelectedAnswer] = useState(null);
  const [isAnswerCorrect, setIsAnswerCorrect] = useState(null);
  const [quizFinished, setQuizFinished] = useState(false);
  const [failedTopics, setFailedTopics] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submissionError, setSubmissionError] = useState(null);

  // Refs to track real-time values (React setState is async)
  const scoreRef = useRef(0);
  const failedRef = useRef([]);

  // Fetch Questions from API
  useEffect(() => {
    const fetchQuestions = async () => {
      try {
        const res = await fetch("/generate-quiz", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ 
            subjects: todaySubjects,
            email: user ? user.email : "",
            sleepHours: Number(sleepHours)
          })
        });
        const data = await res.json();
        
        if (res.ok) {
          setQuestions(data);
        } else if (res.status === 429 || data.isQuotaError) {
          setIsQuotaError(true);
          setError(data.error || "API quota exhausted. Try again later.");
        } else {
          setError(data.error || "Failed to generate quiz");
        }
      } catch (err) {
        setError("Network error. Please try again.");
      }
      setLoading(false);
    };

    if (!Number.isFinite(Number(sleepHours)) || Number(sleepHours) <= 0 || Number(sleepHours) >= 24) {
      setLoading(false);
      setError("Enter daily sleep hours greater than 0 and less than 24 before generating a quiz.");
    } else if (todaySubjects && todaySubjects.length > 0) {
      fetchQuestions();
    } else {
      setLoading(false);
      setError("No subjects studied today to test.");
    }
  }, [todaySubjects, user, sleepHours]);

  const handleSelectOption = (option) => {
    if (selectedAnswer) return; // Prevent double click
    
    setSelectedAnswer(option);
    const correct = option === questions[currentIndex].correctAnswer;
    setIsAnswerCorrect(correct);

    if (correct) {
      scoreRef.current += 1;
      setScore(scoreRef.current);
    } else {
      // Add topic to failed list for Spaced Repetition
      const topic = questions[currentIndex].topic;
      if (!failedRef.current.includes(topic)) {
        failedRef.current = [...failedRef.current, topic];
        setFailedTopics(failedRef.current);
      }
    }
  };

  const handleNext = async () => {
    if (currentIndex < questions.length - 1) {
      setSelectedAnswer(null);
      setIsAnswerCorrect(null);
      setCurrentIndex(prev => prev + 1);
    } else {
      // Finish Quiz
      // Save results to backend
      if (user) {
        setIsSubmitting(true);
        setSubmissionError(null);
        try {
          const response = await fetch("/submit-quiz", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: user.email,
              score: scoreRef.current,
              total: questions.length,
              failedTopics: failedRef.current
            })
          });
          const data = await response.json().catch(() => null);
          if (!response.ok) throw new Error(data?.error || "Unable to save quiz results.");
          setQuizFinished(true);
        } catch (e) {
          console.error("Error saving quiz results", e);
          setSubmissionError(e.message || "Unable to save quiz results. Please try again.");
        } finally {
          setIsSubmitting(false);
        }
      }
    }
  };

  if (loading) {
    return (
      <div className="quiz-fullscreen fade-in">
        <div className="quiz-loading-content">
          <Brain size={64} className="pulse-animation" color="var(--color-accent)" />
          <h2>AI is Generating Your Quiz...</h2>
          <p>Analyzing today's subjects: {todaySubjects.join(", ")}</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="quiz-fullscreen fade-in">
        <div className="quiz-error-content">
          {isQuotaError ? (
            <>
              <Zap size={64} color="#f59e0b" />
              <h2>Daily AI Quota Reached</h2>
              <p style={{ maxWidth: "500px", lineHeight: "1.6", color: "var(--color-subtext)" }}>
                The free-tier Gemini API limit for today has been exhausted. 
                This resets automatically every 24 hours. Try again tomorrow!
              </p>
              <div style={{ display: "flex", gap: "12px", marginTop: "10px" }}>
                <button className="primary-btn" onClick={onExit}>Go Back to Dashboard</button>
              </div>
            </>
          ) : (
            <>
              <h2>Oops!</h2>
              <p>{error}</p>
              <button className="primary-btn" onClick={onExit}>Go Back</button>
            </>
          )}
        </div>
      </div>
    );
  }

  if (quizFinished) {
    const isPerfect = score === questions.length;
    return (
      <div className="quiz-fullscreen fade-in">
        <div className="quiz-scorecard slide-up">
          <div className="scorecard-header">
            {isPerfect ? <Trophy size={64} color="#f59e0b" /> : <Star size={64} color="#3b82f6" />}
            <h2>{isPerfect ? "Perfect Score!" : "Quiz Completed"}</h2>
            <p>You scored {score} out of {questions.length}</p>
          </div>
          
          <div className="scorecard-stats">
            <div className="stat-box">
              <Zap size={24} color="#10b981" />
              <span>+{score * 10} XP Earned</span>
            </div>
            {failedTopics.length > 0 && (
              <div className="stat-box warning">
                <Brain size={24} color="#f43f5e" />
                <span>{failedTopics.length} topics sent to Flashcards for tomorrow.</span>
              </div>
            )}
          </div>

          <button className="primary-btn pulse" onClick={() => { onComplete(); onExit(); }}>
            Claim Rewards & Return
          </button>
        </div>
      </div>
    );
  }

  const currentQ = questions[currentIndex];

  return (
    <div className="quiz-fullscreen fade-in">
      <div className="quiz-header">
        <button className="exit-btn" onClick={onExit}>Exit Quiz</button>
        <div className="quiz-progress-bar">
          <div 
            className="quiz-progress-fill" 
            style={{ width: `${((currentIndex) / questions.length) * 100}%` }}
          ></div>
        </div>
        <div className="quiz-counter">{currentIndex + 1} / {questions.length}</div>
      </div>

      <div className="quiz-body slide-up" key={currentIndex}>
        <div className="quiz-topic-badge">{currentQ.topic}</div>
        <h2 className="quiz-question">{currentQ.question}</h2>

        <div className="quiz-options">
          {currentQ.options.map((option, idx) => {
            let className = "quiz-option-btn";
            if (selectedAnswer) {
              if (option === currentQ.correctAnswer) className += " correct";
              else if (option === selectedAnswer) className += " wrong";
              else className += " disabled";
            }

            return (
              <button 
                key={idx} 
                className={className}
                onClick={() => handleSelectOption(option)}
                disabled={!!selectedAnswer}
              >
                {option}
                {selectedAnswer && option === currentQ.correctAnswer && <CheckCircle size={20} />}
                {selectedAnswer && option === selectedAnswer && option !== currentQ.correctAnswer && <XCircle size={20} />}
              </button>
            );
          })}
        </div>

        {selectedAnswer && !isAnswerCorrect && currentQ.explanation && (
          <div className="quiz-explanation-box fade-in">
            <span className="explanation-title">💡 AI Tutor Note</span>
            <p className="explanation-text">{currentQ.explanation}</p>
          </div>
        )}
      </div>

      {selectedAnswer && (
        <div className="quiz-footer slide-up">
          <div className={`quiz-feedback ${isAnswerCorrect ? 'correct' : 'wrong'}`}>
            {isAnswerCorrect ? "Awesome! Correct." : `Incorrect. The answer is: ${currentQ.correctAnswer}`}
          </div>
          {submissionError && <div className="quiz-feedback wrong">{submissionError}</div>}
          <button className="quiz-next-btn" onClick={handleNext} disabled={isSubmitting}>
            {isSubmitting ? "Saving Results..." : currentIndex < questions.length - 1 ? "Next Question" : submissionError ? "Retry Saving Results" : "See Results"} <ArrowRight size={20} />
          </button>
        </div>
      )}
    </div>
  );
}

export default DailyQuiz;
