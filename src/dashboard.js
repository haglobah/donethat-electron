const { getFunctions, httpsCallable } = require("firebase/functions");
const { firebaseApp } = require('./firebase.js');
const { ipcRenderer } = require('electron');
const { logAnalyticsEvent } = require('./analytics.js');
const { hasSlack, hasSlackToken, getName, getLastSummary, getIsPaused, getDateCreated, getIsPublic, hasEmails } = require('./app-state.js');

const functions = getFunctions(firebaseApp, "europe-west1");

// Create callable function references
const generateRawSummaryFunction = httpsCallable(functions, "generateRawSummary");
const saveFinalSummaryFunction = httpsCallable(functions, "saveFinalSummary");
const discardSummaryFunction = httpsCallable(functions, "summaryDiscard");

// Reference to permission-related elements 
const generateSummaryBtn = document.getElementById("generateSummaryBtn");
const submitSummaryBtn = document.getElementById("submitSummaryBtn");
const summaryContainer = document.getElementById("summaryContainer");
let currentSummaryId = null;
const summaryLoadingSpinner = document.getElementById("summaryLoadingSpinner");

let loadUserSettingsCallback;
let navigateToView;
let showSpinner;
let hideSpinner;

// Helper function to format date for headline
function formatHeadlineDate(timestamp) {
  if (!timestamp) return "DoneThat";

  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  let dateString = "";
  const timeString = date.toLocaleTimeString('en-US', {
    hour: 'numeric', 
    minute: '2-digit',
    hour12: false
  });

  // Create a copy for date comparison without time
  const dateOnly = new Date(date);
  dateOnly.setHours(0, 0, 0, 0);

  // Reset time parts for today/yesterday comparison
  today.setHours(0, 0, 0, 0);
  yesterday.setHours(0, 0, 0, 0);

  if (dateOnly.getTime() === today.getTime()) {
    dateString = "Today";
  } else if (dateOnly.getTime() === yesterday.getTime()) {
    dateString = "Yesterday";
  } else {
    const day = date.getDate();
    const month = date.toLocaleString('en-US', { month: 'short' });
    let suffix = 'th';
    if (day % 10 === 1 && day !== 11) suffix = 'st';
    if (day % 10 === 2 && day !== 12) suffix = 'nd';
    if (day % 10 === 3 && day !== 13) suffix = 'rd';
    dateString = `${month} ${day}${suffix}`;
  }

  return `${dateString} ${timeString}`; // Combine date and time
}

// Update visibility when summary is generated
function showSummaryGeneratedState() {
    document.getElementById('generateSummaryBtn').classList.add('hidden');
    document.getElementById('submitSummaryBtn').classList.remove('hidden');

    // Show visibility note
    const visibilityNoteContainer = document.getElementById('visibilityNoteContainer');
    if (visibilityNoteContainer) {
      const isPublic = getIsPublic();
      const hasRecipients = hasEmails();
      const hasSlackChannel = hasSlackToken(); // Check if Slack token exists (channel implies token)

      let visibilityText = isPublic ? 'Posting to your public feed' : 'Posting to your private feed';
      const destinations = [];
      if (hasRecipients) destinations.push('email recipients');
      if (hasSlackChannel) destinations.push('Slack channel');

      if (destinations.length > 0) {
        visibilityText += ` and ${destinations.join(' and ')}`;
      }
      visibilityText += `. <a href="#" class="settings-link">Change visibility in settings</a>.`;

      visibilityNoteContainer.innerHTML = `<p class="text-xs text-gray-500 text-center">${visibilityText}</p>`;
      visibilityNoteContainer.classList.remove('hidden');

      // Re-add event listener for the link
      visibilityNoteContainer.querySelector('.settings-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        navigateToView('settings');
      });
    }
  }
  
  // Function to handle all dashboard note operations
  function dashboardNote(extraNotes = []) {
    const notes = [];
    
    // Check if app is paused
    if (getIsPaused()) {
      notes.push({
        text: 'DoneThat is paused. <a href="#" class="resume-link">Resume recording</a>.',
        isWarning: true
      });
    }

    // Check if Slack is connected but no channel is set
    if (hasSlack() && !hasSlackToken()) {
      notes.push({
        text: 'No Slack channel configured. <a href="#" class="settings-link">Set it up in settings</a>.',
        isWarning: true
      });
    }

    // Check if name is not set
    if (!getName()) {
      notes.push({
        text: 'Complete your profile setup in <a href="#" class="settings-link">settings</a>.',
        isWarning: true
      });
    }

    // Check for old summaries OR if user is old enough without submitting
    const lastSummary = getLastSummary();
    const dateCreated = getDateCreated();
    const oneDayInMs = 24 * 60 * 60 * 1000;
    let showOldSummaryNote = false;

    if (lastSummary) {
      const lastSummaryDate = new Date(lastSummary);
      if (Date.now() - lastSummaryDate.getTime() > oneDayInMs) {
        showOldSummaryNote = true;
      }
    } else if (dateCreated) {
      // Check if user created more than a day ago and has no summaries
      const dateCreatedDate = new Date(dateCreated); // Assuming dateCreated is a valid timestamp/date string
      if (Date.now() - dateCreatedDate.getTime() > oneDayInMs) {
        showOldSummaryNote = true;
      }
    }

    if (showOldSummaryNote) {
      notes.push({
        text: "Save summaries from your last days to get today's data.",
        isWarning: true
      });
    }

    // Add any extra notes
    notes.push(...extraNotes);

    // Only add default note if no other notes exist
    if (notes.length === 0) {
      notes.push({
        text: "Summaries always show work you did since the last summary.",
        isWarning: false
      });
      notes.push({
        text: "Generate one once you're done for the day.",
        isWarning: false
      });
    }

    // Render the notes
    const notesHTML = notes.map(note => `
      <p class="dashboard-note ${note.isWarning ? 'text-orange-400' : 'text-gray-500'} text-center text-sm">
        ${note.text}
      </p>
    `).join('');

    const summaryContainer = document.getElementById('summaryContainer');
    if (summaryContainer) {
      summaryContainer.innerHTML = notesHTML;

      // Add event listeners for links
      document.querySelectorAll('.resume-link').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          resumeRecording();
        });
      });

      document.querySelectorAll('.settings-link').forEach(link => {
        link.addEventListener('click', (e) => {
          e.preventDefault();
          navigateToView('settings');
        });
      });
    }
  }

  // Reset to initial state
  function resetSummaryState() {
    document.getElementById('generateSummaryBtn').classList.remove('hidden');
    document.getElementById('submitSummaryBtn').classList.add('hidden');
    document.getElementById('visibilityNoteContainer')?.classList.add('hidden'); // Hide note on reset
    currentSummaryId = null;
    selectedBulletPoints = [];
  
    // Reset headline
    const headlineElement = document.getElementById('dashboardHeadline');
    if (headlineElement) {
      headlineElement.textContent = "DoneThat";
    }
    
    dashboardNote();
  }

  // Initialize dashboard
  function initializeDashboard(onSettingsUpdate, showBlockingSpinner, hideBlockingSpinner, viewNavigator) {
    loadUserSettingsCallback = onSettingsUpdate;
    showSpinner = showBlockingSpinner;
    hideSpinner = hideBlockingSpinner;
    navigateToView = viewNavigator;
  }

  // Only add event listeners if elements exist
if (submitSummaryBtn) {
    submitSummaryBtn.addEventListener('click', () => {
      summaryLoadingSpinner.classList.remove('hidden');
  
      const selectedBullets = [];
      document.querySelectorAll('.bullet-item').forEach(item => {
        const checkbox = item.querySelector('.bullet-checkbox');
        const heartIcon = item.querySelector('.heart-icon');
        const textElement = item.querySelector('.bullet-text');
  
        if (checkbox.checked) {
          let bulletText = textElement.textContent.trim();
  
          if (heartIcon.classList.contains('active')) {
            bulletText = '🧡 ' + bulletText;
          }
  
          selectedBullets.push(bulletText);
        }
      });
  
      const commentText = document.getElementById('commentInput').value.trim();
  
      saveFinalSummaryFunction({
        summaryId: currentSummaryId,
        selectedBullets: selectedBullets,
        comment: commentText
      }).then(() => {
        summaryLoadingSpinner.classList.add('hidden');
        // Clear summary content immediately before resetSummary later after delay
        document.getElementById('summaryContainer').innerHTML =
          '<p class="empty-state-text"></p>';
  
        // Reset internal state
        currentSummaryId = null;
        selectedBulletPoints = [];
  
        // Update button text and disable it
        submitSummaryBtn.textContent = "Well done!";
        submitSummaryBtn.disabled = true;
        submitSummaryBtn.classList.add('disabled-btn');
        submitSummaryBtn.classList.remove('hidden');
  
        // Notify main process that summary was submitted
        ipcRenderer.send("summarySubmitted");
  
        // Pause recording until tomorrow
        ipcRenderer.send("pauseUntilTomorrow");
  
        // Log successful summary submission
        logAnalyticsEvent('summary_submitted', {
          status: 'success',
          bullet_points_count: selectedBullets.length,
          has_comment: !!commentText
        });
  
        // Reset summary state AFTER button update and ensure button stays visible
        setTimeout(() => {
          resetSummaryState();
          submitSummaryBtn.textContent = "Done That";
          submitSummaryBtn.classList.remove('disabled-btn');
          submitSummaryBtn.disabled = false;
        }, 10000);
      }).catch((error) => {
        summaryLoadingSpinner.classList.add('hidden');
        console.error("Error submitting summary:", error);
        alert(`Error submitting summary: ${error.message}`);
        
        // Log error in summary submission
        logAnalyticsEvent('summary_submitted', {
          status: 'error',
          error_code: error.code,
          error_message: error.message
        });
      });
    });
  }
  
  // Update the event listener for the generate summary button
  if (generateSummaryBtn) {
    generateSummaryBtn.addEventListener('click', async () => {
      summaryLoadingSpinner.classList.remove('hidden');
  
      // Call the actual Cloud Function instead of using dummy data
      generateRawSummaryFunction()
        .then((result) => {
          summaryLoadingSpinner.classList.add('hidden');
  
          // Process the result from the cloud function
          const bulletPoints = result.data.bulletPoints || [];
          currentSummaryId = result.data.summaryId;
          const period = result.data.period;

          // Update headline
          const headlineElement = document.getElementById('dashboardHeadline');
          if (headlineElement) {
            headlineElement.textContent = formatHeadlineDate(period?.end);
          }

          if (bulletPoints.length === 0) {
            dashboardNote([{
              text: 'No activities found for today. Check if DoneThat is paused and try again in a few minutes.',
              isWarning: true
            }]);
            logAnalyticsEvent('summary_generated', {
              status: 'empty',
              bullet_points_count: 0
            });
            return;
          }
  
          // Format the period timestamps
          const formatDateTime = (timestamp) => {
            if (!timestamp) return '';
            const date = new Date(timestamp);
            return date.toLocaleString('en-US', {
              month: 'short',
              day: 'numeric',
              hour: 'numeric',
              minute: '2-digit',
              hour12: true
            });
          };
  
          const periodHTML = period ? `
            <div class="summary-period">
              Activities from ${formatDateTime(period.start)} to ${formatDateTime(period.end)}
            </div>
          ` : '';
  
          const bulletHTML = bulletPoints.map(point => `
            <div class="bullet-item">
              <input type="checkbox" class="bullet-checkbox" checked>
              <span class="bullet-content bullet-text">${point}</span>
              <span class="heart-icon">♥</span>
            </div>
          `).join('');
  
          const commentHTML = `
            <textarea id="commentInput" class="comment-input" placeholder="Add a comment here"></textarea>
          `;
  
          summaryContainer.innerHTML = periodHTML + bulletHTML + commentHTML;
  
          // Add event listeners for checkboxes and heart icons
          document.querySelectorAll('.bullet-checkbox').forEach(checkbox => {
            checkbox.addEventListener('change', function () {
              const textElement = this.nextElementSibling;
              const heartIcon = textElement.nextElementSibling;
  
              if (this.checked) {
                textElement.classList.remove('bullet-text-crossed');
                heartIcon.classList.remove('opacity-50', 'pointer-events-none');
              } else {
                textElement.classList.add('bullet-text-crossed');
                heartIcon.classList.add('opacity-50', 'pointer-events-none');
                heartIcon.classList.remove('active');
              }
            });
          });
  
          document.querySelectorAll('.heart-icon').forEach(heart => {
            heart.addEventListener('click', function () {
              this.classList.toggle('active');
            });
          });
  
          showSummaryGeneratedState();
          
          // Log successful summary generation
          logAnalyticsEvent('summary_generated', {
            status: 'success',
            bullet_points_count: bulletPoints.length,
            has_period: !!period
          });
        })
        .catch((error) => {
          summaryLoadingSpinner.classList.add('hidden');
          console.error("Error generating summary:", error);
          summaryContainer.innerHTML = `<p class="empty-state-text">Error: ${error.message}</p>`;
          
          // Log error in summary generation
          logAnalyticsEvent('summary_generated', {
            status: 'error',
            error_code: error.code,
            error_message: error.message
          });
        });
    });
  } else {
    console.error("Generate summary button not found");
  }

// Add resume function
function resumeRecording() {
  ipcRenderer.send('resumeRecording');
}

// Add pause state change listener
ipcRenderer.on('pauseStateChanged', () => {
  // Add a small delay back to ensure app state is updated first
  setTimeout(() => {
    dashboardNote();
  }, 100);
});

// Add a function to explicitly refresh notes
function refreshDashboardNotes() {
  dashboardNote();
}

module.exports = { initializeDashboard, resetSummaryState, refreshDashboardNotes };