const { initializeApp } = require("firebase/app");
const { getFunctions, httpsCallable } = require("firebase/functions");
const { getAuth } = require("firebase/auth");
const firebaseConfig = require("../firebase-config.js");

// Initialize Firebase
const firebaseApp = initializeApp(firebaseConfig);
const functions = getFunctions(firebaseApp, "europe-west1");

// Create callable function references with updated names
const subscriptionPlansGetFunction = httpsCallable(functions, 'subscriptionPlans');
const subscriptionIndividualCreateFunction = httpsCallable(functions, 'subscriptionIndividualCreate');
const subscriptionIndividualCancelFunction = httpsCallable(functions, 'subscriptionIndividualCancel');
const subscriptionSetupIntentCreate = httpsCallable(functions, 'subscriptionSetupIntent');

// Module variables to store functions from main app
let loadUserSettingsCallback = null;
let showSpinner = null;
let hideSpinner = null;
let navigateToView = null;

// Stripe elements
let stripe = null;
let elements = null;
let paymentElement = null;

// Data 
let availablePlans = [];
let selectedPlan = null;

async function subscriptionSetupElements() {
  const auth = getAuth();
  
  if (!auth.currentUser) {
    setTimeout(subscriptionSetupElements, 1000);
    return;
  }
  
  try {
    // Wait for Stripe to be available
    let attempts = 0;
    while (!window.Stripe && attempts < 10) {
      await new Promise(resolve => setTimeout(resolve, 500));
      attempts++;
    }

    if (!window.Stripe) {
      throw new Error('Stripe failed to load after multiple attempts');
    }

    const result = await subscriptionSetupIntentCreate({
      isCompany: selectedPlan?.type === 'Team',
      companyId: document.getElementById('companyId')?.value || null
    });
    
    if (!result.data?.clientSecret || !result.data?.publishableKey) {
      throw new Error('Missing client secret or publishable key');
    }
    
    stripe = window.Stripe(result.data.publishableKey);
    
    elements = stripe.elements({
      clientSecret: result.data.clientSecret,
      appearance: {
        theme: 'stripe',
        variables: {
          colorPrimary: '#FFB623',
          fontFamily: 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif',
          spacingUnit: '4px',
          borderRadius: '8px',
          fontSizeBase: '0.75rem'
        }
      }
    });
    
    paymentElement = elements.create('payment', {
      layout: {
        type: 'tabs',
        defaultCollapsed: false
      },
    });
    
    const paymentElementContainer = document.getElementById('payment-element');
    if (paymentElementContainer) {
      paymentElement.mount('#payment-element');
      
      // Start with button disabled
      const subscribeButton = document.getElementById('subscribeButton');
      if (subscribeButton) {
        subscribeButton.disabled = true;
        subscribeButton.classList.add('disabled-btn');
      }
      
      // Listen for changes in the payment element
      paymentElement.on('change', (event) => {
        const subscribeButton = document.getElementById('subscribeButton');
        const errorElement = document.getElementById('card-errors');
        
        if (errorElement) {
          errorElement.textContent = event.error ? event.error.message : '';
        }
        
        // Update button state based on form completeness
        if (subscribeButton) {
          subscribeButton.disabled = !event.complete;
          if (event.complete) {
            subscribeButton.classList.remove('disabled-btn');
          } else {
            subscribeButton.classList.add('disabled-btn');
          }
        }
      });
    } else {
      throw new Error('Payment element container not found');
    }
    
  } catch (error) {
    const errorElement = document.getElementById('card-errors');
    if (errorElement) {
      errorElement.textContent = error.message || 'Could not load payment methods. Please try again later.';
    }
  }
}

/**
 * Initialize the Stripe integration
 */
function subscriptionInitialize(onSettingsUpdate, showBlockingSpinner, hideBlockingSpinner, viewNavigator) {
  loadUserSettingsCallback = onSettingsUpdate;
  showSpinner = showBlockingSpinner;
  hideSpinner = hideBlockingSpinner;
  navigateToView = viewNavigator;
  
  // Check if document is already loaded
  if (document.readyState === 'complete') {
    initializeWhenReady();
  } else {
    // Wait for DOM to be fully loaded before initializing
    document.addEventListener('DOMContentLoaded', initializeWhenReady);
  }

  // Get plans if user is already authenticated
  const auth = getAuth();
  if (auth.currentUser) {
    subscriptionGetPlans().catch(error => {
      console.error('Error fetching initial plans:', error);
    });
  } else {
    // Add auth state listener
    auth.onAuthStateChanged((user) => {
      if (user) {
        subscriptionGetPlans().catch(error => {
          console.error('Error fetching plans after auth:', error);
        });
      }
    });
  }
}

function initializeWhenReady() {
  // Set up subscribe button event listener
  const subscribeButton = document.getElementById('subscribeButton');
  if (subscribeButton) {
    subscribeButton.addEventListener('click', subscriptionHandleSubscribe);
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
  if (!data) {
    return;
  }
  
  const subscriptionView = document.getElementById('subscriptionView');
  const dashboardView = document.getElementById('dashboardView');
  const settingsView = document.getElementById('settingsView');
  
  // If we need to show the subscription view
  if (data.shouldPromptForSubscription) {
    // Hide other views
    dashboardView.classList.add('hidden');
    settingsView.classList.add('hidden');
    
    // Show subscription view
    subscriptionView.classList.remove('hidden');
    
    // If we haven't loaded plans yet, do it now
    if (!selectedPlan) {
      subscriptionGetPlans();
    }
  }
  
  // Update subscription info in the settings view
  updateSubscriptionInfoInSettings(data);
}

/**
 * Update subscription information in settings view
 */
function updateSubscriptionInfoInSettings(data) {
  // Find or create subscription info container in settings
  let subscriptionInfoContainer = document.getElementById('subscriptionInfoContainer');
  
  if (!subscriptionInfoContainer) {
    // Create the container if it doesn't exist
    const dailyReminderContainer = document.querySelector('.form-group');
    
    if (dailyReminderContainer) {
      subscriptionInfoContainer = document.createElement('div');
      subscriptionInfoContainer.id = 'subscriptionInfoContainer';
      subscriptionInfoContainer.className = 'mt-4';
      
      const subscriptionLabel = document.createElement('label');
      subscriptionLabel.className = 'form-label mb-1';
      subscriptionLabel.textContent = 'Subscription';
      
      subscriptionInfoContainer.appendChild(subscriptionLabel);
      
      // Create the info panel
      const infoPanel = document.createElement('div');
      infoPanel.id = 'subscriptionInfoPanel';
      infoPanel.className = 'subscription-info-panel';
      subscriptionInfoContainer.appendChild(infoPanel);
      
      // Add the container after daily reminder
      dailyReminderContainer.appendChild(subscriptionInfoContainer);
    }
  }
  
  // Update subscription info content
  const infoPanel = document.getElementById('subscriptionInfoPanel');
  if (infoPanel) {
    if (data.active) {
      let statusContent = '';
      
      // For company subscription
      if (data.source === 'company') {
        statusContent = `
          <div class="subscription-status-container">
            <p class="subscription-status">Company Subscription Active</p>
            <p class="subscription-detail">You're part of ${data.companyName || 'a company'} subscription</p>
          </div>
        `;
      }
      // For trial
      else if (data.trialActive && data.trialEndsAt) {
        const trialEndDate = new Date(data.trialEndsAt);
        const formattedDate = trialEndDate.toLocaleDateString();
        
        statusContent = `
          <div class="subscription-status-container">
            <p class="subscription-status">Free Trial Active</p>
            <p class="subscription-detail">Your trial ends on ${formattedDate}</p>
            ${data.trialDaysRemaining ? `<p class="subscription-detail">${data.trialDaysRemaining} days remaining</p>` : ''}
          </div>
        `;
      } 
      // For active paid individual subscription
      else if (data.paidActive) {
        const renewalDate = new Date(data.currentPeriodEnd || 0);
        const formattedRenewalDate = renewalDate.toLocaleDateString();
        
        statusContent = `
          <div class="subscription-status-container">
            <p class="subscription-status">Subscription Active</p>
            <p class="subscription-detail">Next billing date: ${formattedRenewalDate}</p>
            <button id="subscriptionCancelBtn" class="subscription-cancel-btn">
              Cancel Subscription
            </button>
          </div>
        `;
      }
      
      infoPanel.innerHTML = statusContent;
      
      // Add event listeners for buttons
      const cancelBtn = document.getElementById('subscriptionCancelBtn');
      if (cancelBtn) {
        cancelBtn.addEventListener('click', subscriptionHandleCancel);
      }
    } else {
      // Not active - show subscribe button
      infoPanel.innerHTML = `
        <div class="subscription-status-container">
          <p class="subscription-status">No Active Subscription</p>
          <button id="subscriptionStartTrialBtn" class="subscription-secondary-btn">
            Start 7-Day Free Trial
          </button>
        </div>
      `;
      
      // Add event listener for trial button
      const startTrialBtn = document.getElementById('subscriptionStartTrialBtn');
      if (startTrialBtn) {
        startTrialBtn.addEventListener('click', () => {
          navigateToView('subscription');
        });
      }
    }
  }
}

/**
 * Handle subscription form submission
 */
async function subscriptionHandleSubscribe(e) {
  e.preventDefault();
  
  const subscribeButton = document.getElementById('subscribeButton');
  const errorMessage = document.getElementById('card-errors');
  
  if (!selectedPlan) {
    errorMessage.textContent = 'No subscription plan available';
    return;
  }
  
  if (!stripe || !elements) {
    errorMessage.textContent = 'Payment system not initialized';
    return;
  }
  
  // Disable the button and show processing state
  subscribeButton.disabled = true;
  subscribeButton.classList.add('disabled-btn');
  subscribeButton.textContent = 'Processing...';
  
  showSpinner();
  
  try {
    // First validate the payment element
    const { error: validationError } = await elements.submit();
    if (validationError) {
      throw new Error(validationError.message);
    }

    // Then confirm the setup
    const { error, setupIntent } = await stripe.confirmSetup({
      elements,
      confirmParams: {
        return_url: window.location.origin,
      },
      redirect: 'if_required'
    });
    
    if (error) {
      throw new Error(error.message);
    }
    
    if (!setupIntent || !setupIntent.payment_method) {
      throw new Error('Failed to set up payment method');
    }
    
    // For individual plans
    const auth = getAuth();
    const result = await subscriptionIndividualCreateFunction({
      email: auth.currentUser.email,
      paymentMethodId: setupIntent.payment_method
    });
    
    if (result.data.error) {
      throw new Error(result.data.error);
    }
    
    // Handle subscription success
    if (loadUserSettingsCallback) {
      await loadUserSettingsCallback();
    }
    
    // Navigate to dashboard
    navigateToView('dashboard');
    
  } catch (error) {
    console.error('Error creating subscription:', error);
    if (errorMessage) {
      errorMessage.textContent = error.message || 'An error occurred while processing your payment.';
    }
    // Re-enable the button on error
    subscribeButton.disabled = false;
    subscribeButton.classList.remove('disabled-btn');
    subscribeButton.textContent = 'Start Free Trial';
  } finally {
    hideSpinner();
  }
}

/**
 * Handle subscription cancellation
 */
async function subscriptionHandleCancel() {
  if (confirm('Are you sure you want to cancel your subscription? You will still have access until the end of your current billing period.')) {
    try {
      showSpinner();
      
      // Use the new function name
      const result = await subscriptionIndividualCancelFunction();
      
      if (result.data.success) {
        alert('Your subscription has been canceled. You will still have access until the end of your current billing period.');
        if (loadUserSettingsCallback) {
          await loadUserSettingsCallback();
        }
      } else {
        alert('There was a problem canceling your subscription. Please try again later.');
      }
    } catch (error) {
      console.error('Error canceling subscription:', error);
      alert('There was a problem canceling your subscription: ' + error.message);
    } finally {
      hideSpinner();
    }
  }
}

/**
 * Fetch available subscription plans
 */
async function subscriptionGetPlans() {
  try {
    // Get current user and ensure they're authenticated
    const auth = getAuth();
    if (!auth.currentUser) {
      return { plans: [] };
    }

    const result = await subscriptionPlansGetFunction();

    availablePlans = result.data.plans || [];
    
    // Find the first Individual plan
    selectedPlan = availablePlans.find(plan => plan.type === 'Individual');
    
    if (selectedPlan) {
      
      // Show the selected plan and update price displays
      displaySelectedPlan(selectedPlan);
    } else {
      console.error('No Individual plan found');
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
function displaySelectedPlan(plan) {
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
  
  // Use the existing payment form
  const paymentForm = document.getElementById('paymentForm');
  if (paymentForm) {
    paymentForm.classList.remove('hidden');
    
    // Disable autofill
    paymentForm.setAttribute('autocomplete', 'off');
    paymentForm.setAttribute('novalidate', true);
    
    // Also disable autofill for the payment element container
    const paymentElement = document.getElementById('payment-element');
    if (paymentElement) {
      paymentElement.setAttribute('autocomplete', 'off');
      paymentElement.setAttribute('data-autofill', 'false');
    }
    
    subscriptionSetupElements();
  } else {
    console.error('Payment form not found');
  }
}

/**
 * Helper function to format period text
 */
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
  subscriptionHandleCancel,
  subscriptionGetPlans
}; 