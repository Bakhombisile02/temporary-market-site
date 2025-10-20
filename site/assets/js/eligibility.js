const ELIGIBILITY_STORAGE_KEY = 'radleyEligibilityProgress'
const ELIGIBILITY_STORAGE_TTL = 24 * 60 * 60 * 1000
const API_ENDPOINT = '/api/eligibility/submit'

const QUESTION_HELPERS = [
  {
    helperTypes: ['city'],
    required: ['city'],
    buttonLabel: 'Confirm location details',
    description: 'Select the primary city where your core R&D work takes place.'
  },
  {
    helperTypes: [],
    required: [],
    buttonLabel: 'Add project context',
    description:
      'Share any key uncertainties you are exploring so we can understand the scope of work.'
  },
  {
    helperTypes: ['rights'],
    required: ['rights'],
    buttonLabel: 'Confirm ownership rights',
    description: 'Choose the rights your organisation keeps over the R&D outcomes.'
  },
  {
    helperTypes: ['entity'],
    required: ['entity'],
    buttonLabel: 'Confirm organisation type',
    description: 'Tell us what type of organisation you operate.'
  },
  {
    helperTypes: ['records'],
    required: ['records'],
    buttonLabel: 'Confirm documentation kept',
    description: 'Choose the records you maintain to evidence your R&D activities.'
  }
]

const DEFAULT_HELPER_CONFIG = {
  helperTypes: [],
  required: [],
  buttonLabel: 'Add details',
  description: ''
}

const HELPER_REQUIRED_MESSAGE = 'Please complete the required details before continuing.'

;(function () {
  const app = document.querySelector('[data-eligibility-app]')

  if (!app) {
    return
  }

  const data = window.RADLEY_ELIGIBILITY_DATA

  const elements = {
    steps: {
      country: app.querySelector('[data-eligibility-step="country"]'),
      questions: app.querySelector('[data-eligibility-step="questions"]'),
      result: app.querySelector('[data-eligibility-step="result"]')
    },
    countryList: app.querySelector('[data-eligibility-countries]'),
    countryNext: app.querySelector('[data-eligibility-country-next]'),
    progressBar: app.querySelector('[data-eligibility-progress-bar]'),
    progressText: app.querySelector('[data-eligibility-progress-text]'),
    progressNudge: app.querySelector('[data-eligibility-progress-nudge]'),
    progressChecks: app.querySelector('[data-eligibility-progress-checks]'),
    questionEyebrow: app.querySelector('[data-eligibility-question-eyebrow]'),
    questionText: app.querySelector('[data-eligibility-question-text]'),
    answerOptions: app.querySelector('[data-eligibility-answer-options]'),
    answerError: app.querySelector('[data-eligibility-answer-error]'),
    noteToggle: app.querySelector('[data-eligibility-note-toggle]'),
    noteToggleText: app.querySelector('[data-eligibility-note-toggle-text]'),
    notePanel: app.querySelector('[data-eligibility-note-panel]'),
    noteDescription: app.querySelector('[data-eligibility-note-description]'),
    noteInput: app.querySelector('[data-eligibility-note-input]'),
    noteCounter: app.querySelector('[data-eligibility-note-counter]'),
    helperEntityGroup: app.querySelector('[data-eligibility-entity-group]'),
    helperEntity: app.querySelector('[data-eligibility-entity]'),
    helperCityGroup: app.querySelector('[data-eligibility-city-group]'),
    helperCity: app.querySelector('[data-eligibility-city]'),
    helperContainer: app.querySelector('[data-eligibility-helpers]'),
    helperRecordsGroup: app.querySelector('[data-eligibility-records-group]'),
    helperRecords: app.querySelector('[data-eligibility-records]'),
    helperRightsGroup: app.querySelector('[data-eligibility-rights-group]'),
    helperRights: app.querySelector('[data-eligibility-rights]'),
    backButton: app.querySelector('[data-eligibility-back]'),
    nextButton: app.querySelector('[data-eligibility-next]'),
    nextButtonLabel: app.querySelector('[data-eligibility-next-label]'),
    loading: app.querySelector('[data-eligibility-loading]'),
    globalError: app.querySelector('[data-eligibility-global-error]'),
    helperError: app.querySelector('[data-eligibility-helper-error]'),
    result: {
      badge: app.querySelector('[data-eligibility-result-badge]'),
      heading: app.querySelector('[data-eligibility-result-heading]'),
      subheading: app.querySelector('[data-eligibility-result-subheading]'),
      details: app.querySelector('[data-eligibility-result-details]')
    },
    restartButton: app.querySelector('[data-eligibility-restart]')
  }

  if (!data) {
    hideLoading()
    showGlobalError('Eligibility data is unavailable right now. Please try again later.')
    return
  }

  const helperOptions = data.helperOptions || {}
  const countries = Array.isArray(data.countries) ? data.countries : []
  if (!countries.length) {
    hideLoading()
    showGlobalError('Eligibility data is unavailable right now. Please try again later.')
    return
  }

  const storage = safeLocalStorage()

  const QUESTIONS_PER_FLOW = 5
  const NUDGE_TEXT = {
    3: 'Two to go',
    4: 'Last one'
  }

  const state = {
    sessionId: loadOrCreateSessionId(storage),
    countryName: null,
    countryData: null,
    answers: [],
    currentIndex: 0,
    isComplete: false
  }

  const persisted = loadPersistedState(storage)
  if (persisted) {
    state.sessionId = persisted.sessionId || state.sessionId
    if (persisted.countryName) {
      const matchedCountry = getCountryByName(persisted.countryName)
      if (matchedCountry) {
        state.countryName = matchedCountry.name
        state.countryData = matchedCountry
        state.answers = hydrateAnswers(matchedCountry, persisted.answers)
        state.currentIndex = clampIndex(persisted.currentIndex || 0)
        state.isComplete = Boolean(persisted.isComplete)
      }
    }
  }

  hideLoading()
  renderCountries()
  renderProgressChecks()
  bindCountryEvents()
  bindQuestionEvents()
  bindResultEvents()

  if (state.countryName) {
    highlightCountry(state.countryName)
    if (state.isComplete) {
      switchStep('result')
      renderResult(persisted?.resultPayload)
    } else if (state.answers.length) {
      switchStep('questions')
      renderQuestion()
    }
  } else {
    switchStep('country')
  }

  function safeLocalStorage() {
    try {
      const { localStorage } = window
      const key = '__eligibility_test__'
      localStorage.setItem(key, '1')
      localStorage.removeItem(key)
      return localStorage
    } catch (error) {
      return null
    }
  }

  function loadOrCreateSessionId(store = storage) {
    const existing = store?.getItem(`${ELIGIBILITY_STORAGE_KEY}-session`)
    if (existing) {
      return existing
    }
    const generated = createUUID()
    store?.setItem(`${ELIGIBILITY_STORAGE_KEY}-session`, generated)
    return generated
  }

  function loadPersistedState(store) {
    if (!store) {
      return null
    }
    const raw = store.getItem(ELIGIBILITY_STORAGE_KEY)
    if (!raw) {
      return null
    }

    try {
      const payload = JSON.parse(raw)
      if (!payload?.timestamp) {
        return null
      }
      if (Date.now() - payload.timestamp > ELIGIBILITY_STORAGE_TTL) {
        store.removeItem(ELIGIBILITY_STORAGE_KEY)
        return null
      }
      return payload
    } catch (error) {
      return null
    }
  }

  function persistState(extra = {}) {
    if (!storage) {
      return
    }
    const payload = {
      timestamp: Date.now(),
      sessionId: state.sessionId,
      countryName: state.countryName,
      answers: state.answers,
      currentIndex: state.currentIndex,
      isComplete: state.isComplete,
      ...extra
    }
    try {
      storage.setItem(ELIGIBILITY_STORAGE_KEY, JSON.stringify(payload))
    } catch (error) {
      // Ignore storage overflow silently to avoid blocking the flow.
    }
  }

  function clearState() {
    state.countryName = null
    state.countryData = null
    state.answers = []
    state.currentIndex = 0
    state.isComplete = false
    storage?.removeItem(ELIGIBILITY_STORAGE_KEY)
  }

  function getCountryByName(name) {
    return countries.find((entry) => entry.name === name)
  }

  function createAnswerSet(country) {
    return country.questions.map((questionText) => ({
      questionText,
      answer: null,
      optionalText: null,
      eligibilityPassed: false,
      details: createEmptyDetails()
    }))
  }

  function hydrateAnswers(country, savedAnswers) {
    if (!Array.isArray(savedAnswers)) {
      return createAnswerSet(country)
    }
    const expected = country.questions
    if (savedAnswers.length !== expected.length) {
      return createAnswerSet(country)
    }

    return expected.map((questionText, index) => {
      const saved = savedAnswers[index] || {}
      if (saved.questionText !== questionText) {
        return {
          questionText,
          answer: null,
          optionalText: null,
          eligibilityPassed: false,
          details: createEmptyDetails()
        }
      }
      return {
        questionText,
        answer: normalizeAnswer(saved.answer),
        optionalText: typeof saved.optionalText === 'string' ? saved.optionalText : null,
        eligibilityPassed: normalizeAnswer(saved.answer) === 'Yes',
        details: hydrateDetails(saved.details)
      }
    })
  }

  function createEmptyDetails() {
    return {
      isOpen: false,
      noteValue: '',
      segments: {
        entity: '',
        city: '',
        records: '',
        rights: ''
      },
      entityType: '',
      city: '',
      records: [],
      rights: []
    }
  }

  function hydrateDetails(saved = {}) {
    const details = createEmptyDetails()
    if (!saved) {
      return details
    }
    details.isOpen = Boolean(saved.isOpen)
    details.noteValue = typeof saved.noteValue === 'string' ? limitText(saved.noteValue) : ''
    if (saved.segments && typeof saved.segments === 'object') {
      details.segments = {
        entity: limitText(saved.segments.entity || ''),
        city: limitText(saved.segments.city || ''),
        records: limitText(saved.segments.records || ''),
        rights: limitText(saved.segments.rights || '')
      }
    }
    if (saved.entityType && typeof saved.entityType === 'string') {
      details.entityType = saved.entityType
    }
    if (saved.city && typeof saved.city === 'string') {
      details.city = saved.city
    }
    if (Array.isArray(saved.records)) {
      details.records = saved.records.filter((item) => typeof item === 'string')
    }
    if (Array.isArray(saved.rights)) {
      details.rights = saved.rights.filter((item) => typeof item === 'string')
    }
    return details
  }

  function renderCountries() {
    if (!elements.countryList) {
      return
    }
    elements.countryList.innerHTML = ''
    countries.forEach((country) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.className = 'eligibility-country'
      button.dataset.countryName = country.name
      button.setAttribute('aria-pressed', state.countryName === country.name ? 'true' : 'false')
      button.innerHTML = `
        <span class="eligibility-country__name">${country.name}</span>
        <span class="eligibility-country__hint">${country.questions.length} questions</span>
      `
      button.addEventListener('click', () => {
        selectCountry(country)
      })
      elements.countryList.appendChild(button)
    })
    updateCountryButtonState()
  }

  function highlightCountry(name) {
    const tiles = elements.countryList?.querySelectorAll('.eligibility-country') || []
    tiles.forEach((tile) => {
      const isActive = tile.dataset.countryName === name
      tile.setAttribute('aria-pressed', isActive ? 'true' : 'false')
    })
    updateCountryButtonState()
  }

  function bindCountryEvents() {
    if (elements.countryNext) {
      elements.countryNext.addEventListener('click', () => {
        if (!state.countryData) {
          return
        }
        switchStep('questions')
        state.currentIndex = 0
        renderQuestion()
        persistState()
      })
    }
  }

  function bindQuestionEvents() {
    elements.backButton?.addEventListener('click', () => {
      if (state.currentIndex === 0) {
        switchStep('country')
        persistState()
        return
      }
      state.currentIndex = clampIndex(state.currentIndex - 1)
      renderQuestion()
      persistState()
    })

    elements.nextButton?.addEventListener('click', async () => {
      const validation = validateAnswer()
      if (!validation.hasAnswer) {
        showAnswerError()
        return
      }
      hideAnswerError()

      if (!validation.helpersValid) {
        const answerState = state.answers[state.currentIndex]
        if (answerState) {
          answerState.details.isOpen = true
          renderNoteUI(answerState.details, true)
          persistState()
        }
        showHelperError(HELPER_REQUIRED_MESSAGE)
        return
      }

      hideHelperError()
      await handleNextAdvance()
    })

    elements.noteToggle?.addEventListener('click', () => {
      const answerState = state.answers[state.currentIndex]
      if (!answerState) {
        return
      }
      answerState.details.isOpen = !answerState.details.isOpen
      updateNoteUI(answerState.details)
      persistState()
    })

    elements.noteInput?.addEventListener('input', (event) => {
      const answerState = state.answers[state.currentIndex]
      if (!answerState) {
        return
      }
      const value = limitText(event.target.value || '')
      answerState.details.noteValue = value
      syncHelperSelectionsWithNote(answerState.details)
      updateNoteCounter(value.length)
      answerState.optionalText = normalizeOptionalText(value)
      persistState()
    })

    elements.helperEntity?.addEventListener('change', (event) => {
      const value = event.target.value || ''
      const answerState = state.answers[state.currentIndex]
      if (!answerState) {
        return
      }
      answerState.details.entityType = value
      updateHelperSegment(answerState.details, 'entity', value ? `Entity type: ${value}.` : '')
      answerState.optionalText = normalizeOptionalText(answerState.details.noteValue)
      persistState()
      renderNoteUI(answerState.details, true)
    })

    elements.helperCity?.addEventListener('change', (event) => {
      const value = event.target.value || ''
      const answerState = state.answers[state.currentIndex]
      if (!answerState) {
        return
      }
      answerState.details.city = value
      updateHelperSegment(answerState.details, 'city', value ? `Location: ${value}.` : '')
      answerState.optionalText = normalizeOptionalText(answerState.details.noteValue)
      persistState()
      renderNoteUI(answerState.details, true)
    })

    elements.helperRecords?.addEventListener('change', (event) => {
      const checkbox = event.target
      if (!checkbox || checkbox.type !== 'checkbox') {
        return
      }
      const value = checkbox.value
      const answerState = state.answers[state.currentIndex]
      if (!answerState) {
        return
      }
      const { details } = answerState
      if (checkbox.checked) {
        if (!details.records.includes(value)) {
          details.records.push(value)
        }
      } else {
        details.records = details.records.filter((entry) => entry !== value)
      }
      const segment = details.records.length ? `Records: ${details.records.join(', ')}.` : ''
      updateHelperSegment(details, 'records', segment)
      answerState.optionalText = normalizeOptionalText(details.noteValue)
      persistState()
      renderNoteUI(details, true)
    })

    elements.helperRights?.addEventListener('click', (event) => {
      const target = event.target.closest('[data-rights-chip]')
      if (!target) {
        return
      }
      const value = target.dataset.rightsChip
      const answerState = state.answers[state.currentIndex]
      if (!answerState) {
        return
      }
      const { details } = answerState
      const hasValue = details.rights.includes(value)
      details.rights = hasValue
        ? details.rights.filter((entry) => entry !== value)
        : [...details.rights, value]
      const segment = details.rights.length ? `Rights: ${details.rights.join(', ')}.` : ''
      updateHelperSegment(details, 'rights', segment)
      answerState.optionalText = normalizeOptionalText(details.noteValue)
      persistState()
      renderNoteUI(details, true)
    })
  }

  function bindResultEvents() {
    elements.restartButton?.addEventListener('click', () => {
      clearState()
      renderCountries()
      renderProgressChecks()
      hideAnswerError()
      switchStep('country')
    })
  }

  function selectCountry(country) {
    state.countryName = country.name
    state.countryData = country
    state.answers = createAnswerSet(country)
    state.currentIndex = 0
    state.isComplete = false
    highlightCountry(country.name)
    renderProgressChecks()
    persistState()
  }

  function updateCountryButtonState() {
    if (!elements.countryNext) {
      return
    }
    elements.countryNext.disabled = !state.countryData
  }

  function renderProgressChecks() {
    if (!elements.progressChecks) {
      return
    }
    elements.progressChecks.innerHTML = ''
    const count = state.countryData?.questions.length || QUESTIONS_PER_FLOW
    for (let index = 0; index < count; index += 1) {
      const span = document.createElement('span')
      span.className = 'eligibility-progress__check'
      span.dataset.index = String(index)
      span.dataset.complete = state.answers[index]?.answer ? 'true' : 'false'
      span.textContent = '✓'
      elements.progressChecks.appendChild(span)
    }
  }

  function switchStep(step) {
    Object.entries(elements.steps).forEach(([key, node]) => {
      if (!node) {
        return
      }
      const isActive = key === step
      node.setAttribute('aria-hidden', isActive ? 'false' : 'true')
    })
  }

  function renderQuestion() {
    const answerState = state.answers[state.currentIndex]
    if (!answerState || !state.countryData) {
      return
    }
    updateProgress()
    renderProgressChecks()
    const eyebrowText = `${state.countryData.name} · Question ${state.currentIndex + 1}`
    if (elements.questionEyebrow) {
      elements.questionEyebrow.textContent = eyebrowText
    }
    if (elements.questionText) {
      elements.questionText.textContent = answerState.questionText
    }
    renderAnswerOptions(answerState)
    renderNoteUI(answerState.details, false)
    updateNavigationButtons()
    hideAnswerError()
    hideHelperError()
  }

  function renderAnswerOptions(answerState) {
    if (!elements.answerOptions) {
      return
    }
    elements.answerOptions.innerHTML = ''
    ;['Yes', 'No'].forEach((label) => {
      const option = document.createElement('label')
      option.className = 'eligibility-answer'
      option.dataset.value = label
      option.dataset.selected = answerState.answer === label ? 'true' : 'false'
      option.tabIndex = 0
      option.innerHTML = `
        <input type="radio" name="eligibility-answer" value="${label}" />
        ${label}
      `
      option.addEventListener('click', () => {
        setAnswer(answerState, label)
      })
      option.addEventListener('keypress', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          setAnswer(answerState, label)
        }
      })
      elements.answerOptions.appendChild(option)
    })
  }

  function setAnswer(answerState, value) {
    answerState.answer = normalizeAnswer(value)
    answerState.eligibilityPassed = answerState.answer === 'Yes'
    answerState.optionalText = normalizeOptionalText(answerState.details.noteValue)
    const options = elements.answerOptions?.querySelectorAll('.eligibility-answer') || []
    options.forEach((option) => {
      option.dataset.selected = option.dataset.value === answerState.answer ? 'true' : 'false'
    })
    hideAnswerError()
    updateProgress()
    persistState()
  }

  function renderNoteUI(details, skipToggleSync) {
    if (!elements.notePanel || !elements.noteToggle) {
      return
    }
    const wasOpen = elements.notePanel.dataset.open === 'true'
    const config = getHelperConfig(state.currentIndex)
    applyHelperConfig(config, details)
    elements.notePanel.dataset.open = details.isOpen ? 'true' : 'false'
    elements.noteToggle.setAttribute('aria-expanded', details.isOpen ? 'true' : 'false')
    elements.notePanel.hidden = !details.isOpen

    if (elements.noteInput) {
      elements.noteInput.value = details.noteValue
      updateNoteCounter(details.noteValue.length)
    }

    if (!skipToggleSync) {
      populateHelperOptions(details, config)
    }
    synchronizeCheckboxStyles()

    if (details.isOpen && !wasOpen) {
      focusFirstHelper(config)
    }
  }

  function getHelperConfig(index) {
    const config = QUESTION_HELPERS[index] || DEFAULT_HELPER_CONFIG
    return {
      helperTypes: Array.isArray(config.helperTypes) ? [...config.helperTypes] : [],
      required: Array.isArray(config.required) ? [...config.required] : [],
      buttonLabel: config.buttonLabel || DEFAULT_HELPER_CONFIG.buttonLabel,
      description: config.description || ''
    }
  }

  function applyHelperConfig(config, details) {
    if (!details) {
      return
    }
    if (elements.noteToggleText) {
      elements.noteToggleText.textContent = config.buttonLabel || DEFAULT_HELPER_CONFIG.buttonLabel
    }

    if (elements.noteDescription) {
      if (config.description) {
        elements.noteDescription.textContent = config.description
        elements.noteDescription.hidden = false
      } else {
        elements.noteDescription.textContent = ''
        elements.noteDescription.hidden = true
      }
    }

    const helperGroups = {
      entity: elements.helperEntityGroup,
      city: elements.helperCityGroup,
      records: elements.helperRecordsGroup,
      rights: elements.helperRightsGroup
    }

    Object.entries(helperGroups).forEach(([type, node]) => {
      if (!node) {
        return
      }
      const isEnabled = config.helperTypes.includes(type)
      node.hidden = !isEnabled
      node.style.display = isEnabled ? '' : 'none'
      if (!isEnabled) {
        clearHelperSelection(details, type)
      }
    })

    if (elements.helperContainer) {
      const shouldShowHelpers = config.helperTypes.length > 0
      elements.helperContainer.hidden = !shouldShowHelpers
      elements.helperContainer.style.display = shouldShowHelpers ? '' : 'none'
    }

    if (elements.noteToggle) {
      if (config.required.length) {
        elements.noteToggle.dataset.required = 'true'
      } else {
        delete elements.noteToggle.dataset.required
      }
    }

    const helpersValid = validateHelperSelections(details, config)
    if (!config.required.length || helpersValid || !details.isOpen) {
      hideHelperError()
    }
  }

  function updateNoteUI(details) {
    if (!details) {
      return
    }
    const config = getHelperConfig(state.currentIndex)
    if (!details.isOpen && config.required.length) {
      if (!validateHelperSelections(details, config)) {
        details.isOpen = true
        renderNoteUI(details, true)
        showHelperError(HELPER_REQUIRED_MESSAGE)
        return
      }
    }
    hideHelperError()
    renderNoteUI(details, true)
  }

  function clearHelperSelection(details, type) {
    if (!details) {
      return
    }
    if (type === 'entity') {
      if (details.entityType) {
        details.entityType = ''
        updateHelperSegment(details, 'entity', '')
      }
      if (elements.helperEntity) {
        elements.helperEntity.value = ''
      }
      return
    }
    if (type === 'city') {
      if (details.city) {
        details.city = ''
        updateHelperSegment(details, 'city', '')
      }
      if (elements.helperCity) {
        elements.helperCity.value = ''
      }
      return
    }
    if (type === 'records') {
      if (details.records.length) {
        details.records = []
        updateHelperSegment(details, 'records', '')
      }
      const checkboxes = elements.helperRecords?.querySelectorAll('input[type="checkbox"]') || []
      checkboxes.forEach((input) => {
        input.checked = false
        input.parentElement && (input.parentElement.dataset.selected = 'false')
      })
      return
    }
    if (type === 'rights') {
      if (details.rights.length) {
        details.rights = []
        updateHelperSegment(details, 'rights', '')
      }
      const chips = elements.helperRights?.querySelectorAll('[data-rights-chip]') || []
      chips.forEach((chip) => {
        chip.dataset.selected = 'false'
      })
    }
  }

  function validateHelperSelections(details, config) {
    if (!details) {
      return true
    }
    return config.required.every((type) => {
      if (type === 'entity') {
        return Boolean(details.entityType)
      }
      if (type === 'city') {
        return Boolean(details.city)
      }
      if (type === 'records') {
        return Array.isArray(details.records) && details.records.length > 0
      }
      if (type === 'rights') {
        return Array.isArray(details.rights) && details.rights.length > 0
      }
      return true
    })
  }

  function showHelperError(message) {
    if (!elements.helperError) {
      return
    }
    elements.helperError.textContent = message
    elements.helperError.hidden = false
  }

  function hideHelperError() {
    if (!elements.helperError) {
      return
    }
    elements.helperError.hidden = true
    elements.helperError.textContent = ''
  }

  function populateHelperOptions(details, config) {
    populateEntitySelect(details, config)
    populateCitySelect(details, config)
    populateRecords(details, config)
    populateRights(details, config)
  }

  function populateEntitySelect(details, config) {
    if (!elements.helperEntity || !config.helperTypes.includes('entity')) {
      return
    }
    const values = helperOptions.entityTypes || []
    elements.helperEntity.innerHTML = '<option value="">Select entity type</option>'
    values.forEach((entry) => {
      const option = document.createElement('option')
      option.value = entry
      option.textContent = entry
      if (details.entityType === entry) {
        option.selected = true
      }
      elements.helperEntity.appendChild(option)
    })
  }

  function populateCitySelect(details, config) {
    if (!elements.helperCity || !config.helperTypes.includes('city')) {
      return
    }
    const cities = state.countryData?.cities || []
    elements.helperCity.innerHTML = '<option value="">Select city</option>'
    cities.forEach((city) => {
      const option = document.createElement('option')
      option.value = city
      option.textContent = city
      if (details.city === city) {
        option.selected = true
      }
      elements.helperCity.appendChild(option)
    })
  }

  function populateRecords(details, config) {
    if (!elements.helperRecords || !config.helperTypes.includes('records')) {
      return
    }
    elements.helperRecords.innerHTML = ''
    const records = helperOptions.records || []
    records.forEach((record) => {
      const label = document.createElement('label')
      label.dataset.selected = details.records.includes(record) ? 'true' : 'false'
      label.innerHTML = `
        <input type="checkbox" value="${record}" ${
        details.records.includes(record) ? 'checked' : ''
      } />
        <span>${record}</span>
      `
      elements.helperRecords.appendChild(label)
    })
  }

  function populateRights(details, config) {
    if (!elements.helperRights || !config.helperTypes.includes('rights')) {
      return
    }
    elements.helperRights.innerHTML = ''
    const rights = helperOptions.rights || []
    rights.forEach((item) => {
      const chip = document.createElement('button')
      chip.type = 'button'
      chip.className = 'eligibility-note__chip'
      chip.dataset.rightsChip = item
      chip.dataset.selected = details.rights.includes(item) ? 'true' : 'false'
      chip.textContent = item
      elements.helperRights.appendChild(chip)
    })
  }

  function updateHelperSegment(details, key, newSegment) {
    const previousSegment = details.segments[key]
    if (previousSegment) {
      details.noteValue = removeSegment(details.noteValue, previousSegment)
    }
    details.segments[key] = newSegment ? limitText(newSegment) : ''
    if (details.segments[key]) {
      details.noteValue = appendSegment(details.noteValue, details.segments[key])
    }
    details.noteValue = limitText(details.noteValue)
    if (elements.noteInput) {
      elements.noteInput.value = details.noteValue
      updateNoteCounter(details.noteValue.length)
    }
    syncHelperSelectionsWithNote(details)
  }

  function synchronizeCheckboxStyles() {
    const details = state.answers[state.currentIndex]?.details
    const labels = elements.helperRecords?.querySelectorAll('label') || []
    labels.forEach((label) => {
      const input = label.querySelector('input[type="checkbox"]')
      if (!input) {
        return
      }
      const isChecked = details?.records.includes(input.value)
      input.checked = Boolean(isChecked)
      label.dataset.selected = isChecked ? 'true' : 'false'
    })
    const chips = elements.helperRights?.querySelectorAll('[data-rights-chip]') || []
    chips.forEach((chip) => {
      const value = chip.dataset.rightsChip
      const isSelected = details?.rights.includes(value)
      chip.dataset.selected = isSelected ? 'true' : 'false'
    })
  }

  function focusFirstHelper(config) {
    const helperTypes = Array.isArray(config.helperTypes) ? config.helperTypes : []
    for (const type of helperTypes) {
      if (type === 'entity' && elements.helperEntityGroup && !elements.helperEntityGroup.hidden) {
        focusInteractive(elements.helperEntity)
        return
      }
      if (type === 'city' && elements.helperCityGroup && !elements.helperCityGroup.hidden) {
        focusInteractive(elements.helperCity)
        return
      }
      if (type === 'records' && elements.helperRecordsGroup && !elements.helperRecordsGroup.hidden) {
        const checkbox = elements.helperRecords?.querySelector('input[type="checkbox"]')
        if (checkbox) {
          focusInteractive(checkbox)
          return
        }
      }
      if (type === 'rights' && elements.helperRightsGroup && !elements.helperRightsGroup.hidden) {
        const chip = elements.helperRights?.querySelector('[data-rights-chip]')
        if (chip) {
          focusInteractive(chip)
          return
        }
      }
    }
    if (elements.noteInput) {
      focusInteractive(elements.noteInput)
    }
  }

  function focusInteractive(node) {
    if (!node || typeof node.focus !== 'function') {
      return
    }
    const focusTarget = () => {
      try {
        node.focus({ preventScroll: true })
      } catch (error) {
        node.focus()
      }
    }
    if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
      window.requestAnimationFrame(focusTarget)
    } else {
      setTimeout(focusTarget, 0)
    }
  }

  function syncHelperSelectionsWithNote(details) {
    Object.entries(details.segments).forEach(([key, segment]) => {
      if (segment && !details.noteValue.includes(segment)) {
        details.segments[key] = ''
        if (key === 'entity') {
          details.entityType = ''
        }
        if (key === 'city') {
          details.city = ''
        }
        if (key === 'records') {
          details.records = []
        }
        if (key === 'rights') {
          details.rights = []
        }
      }
    })
    synchronizeCheckboxStyles()
    if (elements.helperEntity) {
      elements.helperEntity.value = details.entityType || ''
    }
    if (elements.helperCity) {
      elements.helperCity.value = details.city || ''
    }
  }

  function updateNoteCounter(count) {
    if (elements.noteCounter) {
      elements.noteCounter.textContent = `${count} / 250`
    }
  }

  function appendSegment(note, segment) {
    if (!segment) {
      return note
    }
    if (!note) {
      return segment
    }
    const trimmed = note.trim()
    if (!trimmed.endsWith('.') && !trimmed.endsWith('!') && !trimmed.endsWith('?')) {
      return `${trimmed}. ${segment}`.trim()
    }
    return `${trimmed} ${segment}`.trim()
  }

  function removeSegment(note, segment) {
    if (!segment) {
      return note
    }
    const regex = new RegExp(segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')
    return note
      .replace(regex, '')
      .replace(/\s{2,}/g, ' ')
      .trim()
  }

  function limitText(value) {
    if (!value) {
      return ''
    }
    return value.length > 250 ? value.slice(0, 250) : value
  }

  function normalizeAnswer(value) {
    if (!value) {
      return null
    }
    const normalized = value.toString().trim().toLowerCase()
    if (normalized === 'yes') {
      return 'Yes'
    }
    if (normalized === 'no') {
      return 'No'
    }
    return null
  }

  function normalizeOptionalText(value) {
    const trimmed = (value || '').trim()
    if (!trimmed) {
      return null
    }
    return limitText(trimmed)
  }

  function updateProgress() {
    if (!state.countryData) {
      return
    }
    const answeredCount = state.answers.filter((entry) => entry.answer).length
    const progress = Math.round((answeredCount / state.countryData.questions.length) * 100)
    if (elements.progressBar) {
      elements.progressBar.style.width = `${Math.max(
        progress,
        (state.currentIndex / state.countryData.questions.length) * 100
      )}%`
    }
    if (elements.progressText) {
      elements.progressText.textContent = `${state.currentIndex + 1} of ${
        state.countryData.questions.length
      }`
    }
    if (elements.progressNudge) {
      const nudgeText = NUDGE_TEXT[answeredCount] || ''
      elements.progressNudge.textContent = nudgeText
    }
    const checks = elements.progressChecks?.querySelectorAll('.eligibility-progress__check') || []
    checks.forEach((check, idx) => {
      const isComplete = Boolean(state.answers[idx]?.answer)
      check.dataset.complete = isComplete ? 'true' : 'false'
    })
  }

  function updateNavigationButtons() {
    if (state.currentIndex === 0) {
      elements.backButton?.setAttribute('data-variant', 'ghost')
      elements.backButton?.setAttribute('aria-label', 'Back to country selection')
    }
    if (state.currentIndex === state.answers.length - 1) {
      setNextButtonLabel('Get results')
    } else {
      setNextButtonLabel('Next question')
    }
  }

  function validateAnswer() {
    const answerState = state.answers[state.currentIndex]
    const hasAnswer = Boolean(answerState?.answer)
    const config = getHelperConfig(state.currentIndex)
    const details = answerState?.details
    let helpersValid = true
    if (config.required.length && details) {
      helpersValid = validateHelperSelections(details, config)
    }
    return {
      hasAnswer,
      helpersValid
    }
  }

  function showAnswerError() {
    if (elements.answerError) {
      elements.answerError.hidden = false
    }
  }

  function hideAnswerError() {
    if (elements.answerError) {
      elements.answerError.hidden = true
    }
  }

  async function handleNextAdvance() {
    if (state.currentIndex < state.answers.length - 1) {
      state.currentIndex = clampIndex(state.currentIndex + 1)
      renderQuestion()
      persistState()
      return
    }
    await submitEligibility()
  }

  async function submitEligibility() {
    if (!state.countryData) {
      return
    }
    elements.nextButton.disabled = true
    setNextButtonLabel('Submitting...')
    hideAnswerError()
    hideGlobalError()

    const payload = {
      session_id: state.sessionId,
      country: state.countryData.name,
      questions: state.answers.map((entry) => ({
        question_text: entry.questionText,
        answer: entry.answer,
        optional_text: entry.optionalText
      }))
    }

    try {
      const response = await fetch(API_ENDPOINT, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })

      const body = await response.json()

      if (!response.ok || (body.errors && body.errors.length)) {
        const firstError = body?.errors?.[0]?.message || 'Please choose Yes or No'
        showGlobalError(firstError)
        elements.nextButton.disabled = false
        setNextButtonLabel('Get results')
        return
      }

      state.isComplete = true
      persistState({ resultPayload: body })
      renderResult(body)
      switchStep('result')
    } catch (error) {
      showGlobalError('We could not save your answers right now. Please try again in a moment.')
      elements.nextButton.disabled = false
      setNextButtonLabel('Get results')
    }
  }

  function setNextButtonLabel(text) {
    if (elements.nextButtonLabel) {
      elements.nextButtonLabel.textContent = text
      return
    }
    if (elements.nextButton) {
      elements.nextButton.textContent = text
    }
  }

  function renderResult(result) {
    if (!result) {
      return
    }
    configureResultBadge(result.overall_summary)
    if (elements.result.heading) {
      elements.result.heading.textContent = result.overall_summary
    }
    if (elements.result.subheading) {
      elements.result.subheading.textContent = buildResultSubheading(result.overall_summary)
    }
    if (elements.result.details) {
      elements.result.details.innerHTML = ''
      result.questions.forEach((entry, index) => {
        const item = document.createElement('div')
        item.className = 'eligibility-result__item'
        item.innerHTML = `
          <h4>${index + 1}. ${entry.question_text}</h4>
          <div class="eligibility-result__meta">
            <span><strong>Answer:</strong> ${entry.answer}</span>
            ${
              entry.optional_text
                ? `<span><strong>Note:</strong> ${entry.optional_text}</span>`
                : ''
            }
          </div>
        `
        elements.result.details.appendChild(item)
      })
    }
  }

  function configureResultBadge(summary) {
    if (!elements.result.badge) {
      return
    }
    let variant = 'success'
    let label = 'Likely eligible'
    if (summary === 'Potential Eligibility Issues') {
      variant = 'warning'
      label = 'Potential follow up needed'
    } else if (
      summary === "Incomplete Submission – Please Answer All Questions with 'Yes' or 'No'"
    ) {
      variant = 'error'
      label = 'Incomplete submission'
    }
    elements.result.badge.dataset.variant = variant
    elements.result.badge.textContent = label
  }

  function buildResultSubheading(summary) {
    if (summary === 'Likely Eligible for Early Access') {
      return 'Looks promising. Join the waitlist and our team will reach out about early access.'
    }
    if (summary === 'Potential Eligibility Issues') {
      return 'Your answers suggest there may be blockers. Join the waitlist so we can review with you.'
    }
    return 'You still have questions to finish. Restart the check to complete your submission.'
  }

  function showGlobalError(message) {
    if (!elements.globalError) {
      return
    }
    elements.globalError.textContent = message
    elements.globalError.hidden = false
  }

  function hideGlobalError() {
    if (!elements.globalError) {
      return
    }
    elements.globalError.hidden = true
  }

  function hideLoading() {
    if (elements.loading) {
      elements.loading.hidden = true
    }
  }

  function clampIndex(index) {
    if (!state.countryData) {
      return 0
    }
    const max = state.countryData.questions.length - 1
    return Math.max(0, Math.min(index, max))
  }

  function createUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID()
    }
    const template = 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'
    return template.replace(/[xy]/g, (char) => {
      const rand = (Math.random() * 16) | 0
      const value = char === 'x' ? rand : (rand & 0x3) | 0x8
      return value.toString(16)
    })
  }
})()
