const { initializeApp } = require("firebase/app");
const { getFunctions, httpsCallable } = require("firebase/functions");
const { getAuth } = require("firebase/auth");
const firebaseConfig = require("../firebase-config.js");

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const functions = getFunctions(firebaseApp, "europe-west1");

// Create callable function references
const subscriptionIndividualCreateFunction = httpsCallable(functions, 'subscriptionIndividualPayment');

// Module variables to store functions from main app
let loadUserSettingsCallback = null;
let showSpinner = null;
let hideSpinner = null;
let navigateToView = null;
let checkoutUrl = null;

/**
 * Initialize the subscription module
 */
function subscriptionInitialize(onSettingsUpdate, showBlockingSpinner, hideBlockingSpinner, viewNavigator) {
  
  loadUserSettingsCallback = onSettingsUpdate;
  showSpinner = showBlockingSpinner;
  hideSpinner = hideBlockingSpinner;
  navigateToView = viewNavigator;
  
  // Set up button click handler
  const subscribeButton = document.getElementById('subscribeButton');
  const subscriptionActionBtn = document.getElementById('subscriptionActionBtn');

  subscribeButton.addEventListener('click', () => {
    subscriptionHandleSubscribe();
  });

  // Add click handler for subscription action button
  if (subscriptionActionBtn) {
    subscriptionActionBtn.addEventListener('click', () => {
      const { shell } = require('electron');
      shell.openExternal('https://app.donethat.ai');
    });
  }

  // Set up team link to open in external browser
  document.addEventListener('click', (e) => {
    if (e.target.tagName === 'A' && e.target.getAttribute('href') === 'https://app.donethat.ai') {
      e.preventDefault();
      const { shell } = require('electron');
      shell.openExternal('https://app.donethat.ai');
    }
  });
}

/**
 * Update UI elements based on subscription status
 */
function subscriptionUpdateUI(data) {
  // If we need to show the subscription view or there's no active subscription
  if (data.shouldPromptForSubscription || !data.active) {
    createCheckoutSession().catch(error => {
      console.error('Error initializing subscription:', error);
    });
  } else {
    // Update subscription text
    const subscriptionInput = document.getElementById('subscriptionInput');
    if (subscriptionInput) {
      let statusText = '';
      
      // For team subscription
      if (data.source === 'team') {
        // Find the first active team to display
        statusText = `Part of ${data.teamName || 'a team'} subscription`;
      }
      // For individual subscription
      else {
        if (data.trialActive && data.trialEndsAt) {
          const trialEndDate = new Date(data.trialEndsAt);
          const formattedDate = trialEndDate.toLocaleDateString();
          statusText = `Trial ends on ${formattedDate}`;
        } else if (data.paidActive && data.currentPeriodEnd) {
          const renewalDate = new Date(data.currentPeriodEnd);
          const formattedDate = renewalDate.toLocaleDateString();
          statusText = `Renews on ${formattedDate}`;
        }
      }

      subscriptionInput.value = statusText;
    }
  }
}

async function createCheckoutSession() {
  try {
    // Get current user and ensure they're authenticated
    const auth = getAuth();
    if (!auth.currentUser) {
      console.log('No authenticated user, cannot create subscription intent');
      return { plans: [] };
    }

    const result = await subscriptionIndividualCreateFunction();
    checkoutUrl = result.data.checkoutUrl;
    plan = result.data.plan || {};

    if (plan) {
      // Show the selected plan and update price displays
      displayPlan(plan);
    }

    return result.data;
  } catch (error) {
    console.error('Error fetching plans:', error);
    throw error;
  }
}

/**
 * Display the selected plan in the UI
 */
function displayPlan(plan) {
  
  // Get trial days from plan
  const trialDays = plan.trial?.days || 0;

  // Format price and period
  let formattedPrice = 'Free';
  let periodText = '';
  if (plan.price) {
    if (plan.price.amount) {
      formattedPrice = (plan.price.amount / 100).toLocaleString('en-US', {
        style: 'currency',
        currency: plan.price.currency.toUpperCase()
      });
    }
    periodText = getFormattedPeriod(plan.price);
  }

  // Update header and description
  const sectionHeader = document.querySelector('#subscriptionView h1') ||
    document.querySelector('#subscriptionView .section-header') ||
    document.querySelector('.section-header');
  if (sectionHeader) {
    const headerText = trialDays ? `${trialDays}-Day Free Trial` : 'Subscribe';
    sectionHeader.textContent = headerText;
  }

  const trialDescription = document.querySelector('#subscriptionView .text-sm.text-gray-600.text-center.mb-4');
  if (trialDescription) {
    trialDescription.textContent = trialDays
      ? `Try Done That for ${trialDays} days, no strings attached.`
      : 'Get started with Done That today.';
  }

  // Update all price elements
  document.querySelectorAll('.subscription-price, .subscription-bullet-price').forEach(element => {
    element.textContent = formattedPrice;
  });

  // Update all period elements
  document.querySelectorAll('.subscription-period, .subscription-bullet-period').forEach(element => {
    element.textContent = periodText;
  });

  // Update bullet points with trial text and price
  const bulletPoints = document.querySelectorAll('.bullet-item');
  if (bulletPoints.length > 0) {
    const lastBullet = bulletPoints[bulletPoints.length - 1];
    const contentElement = lastBullet.querySelector('.bullet-content');

    if (contentElement) {
      const priceText = trialDays
        ? `after your ${trialDays}-day free trial ends`
        : 'billed';
      contentElement.innerHTML = `${priceText} <span class="subscription-bullet-price">${formattedPrice}</span><span class="subscription-bullet-period">${periodText}</span>`;
    }
  }

  // Update button text based on trial status
  const subscribeButton = document.getElementById('subscribeButton');
  if (subscribeButton) {
    subscribeButton.disabled = false;
    subscribeButton.classList.remove('disabled-btn');
  }
}

/**
 * Handle subscription form submission
 */
async function subscriptionHandleSubscribe() {

  const errorMessage = document.getElementById('card-errors');
  
  try {    
    const authWindow = window.open(checkoutUrl);

    // Function to cleanup listeners
    const cleanup = () => {
      window.removeEventListener('focus', checkWindowClosed);
    };

    // Function to check if auth window was closed
    const checkWindowClosed = () => {
      if (loadUserSettingsCallback) loadUserSettingsCallback();

      if (authWindow.closed) {
        cleanup();
      }
    };

    // Add focus listener
    window.addEventListener('focus', checkWindowClosed);
    
    // Safety cleanup after 5 minutes
    setTimeout(() => {
      cleanup();
      if (!authWindow.closed) {
        authWindow.close();
        if (loadUserSettingsCallback) loadUserSettingsCallback();
      }
    }, 5 * 60 * 1000);

  } catch (error) {
    console.error('Subscription error:', error);
    errorMessage.textContent = error.message || 'An error occurred while setting up payment. Please try again later.';
  }
}


function getFormattedPeriod(price) {
  if (!price || !price.interval) return '';

  const interval = price.interval;
  const count = price.intervalCount || 1;

  let periodText = '/month';
  if (interval === 'year') {
    periodText = count > 1 ? `/${count} years` : '/year';
  } else if (interval === 'month') {
    periodText = count > 1 ? `/${count} months` : '/month';
  } else if (interval === 'week') {
    periodText = count > 1 ? `/${count} weeks` : '/week';
  } else if (interval === 'day') {
    periodText = count > 1 ? `/${count} days` : '/day';
  }

  return periodText;
}

module.exports = {
  subscriptionInitialize,
  subscriptionUpdateUI
}; 
