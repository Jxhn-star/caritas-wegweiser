const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
$$('svg:not([aria-label])').forEach(svg => svg.setAttribute('aria-hidden', 'true'));

const IS_GITHUB_PAGES = window.location.hostname.endsWith('github.io');
const API_BASE_URL = IS_GITHUB_PAGES
  ? 'https://caritas-wegweiser-projekt.johnxax.chatgpt.site'
  : '';

const bookingModal = $('#bookingModal');
const scannerModal = $('#scannerModal');
const aiPanel = $('#aiPanel');
const toast = $('#toast');
let cameraStream = null;
let previewUrl = null;
let currentSiteLanguage = 'de';
let lastFocusedElement = null;
let lastAiFocusedElement = null;

function focusableElements(root) {
  return $$('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])', root)
    .filter(element => !element.hidden && element.offsetParent !== null && !element.closest('[inert]'));
}

function showToast(message) {
  toast.textContent = message;
  translateDynamicSection(toast);
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function openModal(modal) {
  if (!$('.modal.open')) lastFocusedElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  $$('.modal.open').filter(item => item !== modal).forEach(item => {
    item.classList.remove('open');
    item.setAttribute('aria-hidden', 'true');
    item.setAttribute('inert', '');
  });
  modal.classList.add('open');
  modal.setAttribute('aria-hidden', 'false');
  modal.removeAttribute('inert');
  document.body.style.overflow = 'hidden';
  translateDynamicSection(modal);
  setTimeout(() => $('.modal-close', modal)?.focus(), 50);
}

function closeModals({ restoreFocus = true } = {}) {
  const hadOpenModal = Boolean($('.modal.open'));
  $$('.modal.open').forEach((modal) => {
    modal.classList.remove('open');
    modal.setAttribute('aria-hidden', 'true');
    modal.setAttribute('inert', '');
  });
  document.body.style.overflow = '';
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  stopPageReading(false);
  const video = $('#cameraVideo');
  if (video) {
    video.srcObject = null;
    video.style.display = 'none';
  }
  const cameraButton = $('#startCamera');
  if (cameraButton) cameraButton.textContent = 'Kamera öffnen';
  if (hadOpenModal && restoreFocus && lastFocusedElement?.isConnected) lastFocusedElement.focus();
}

$$('.modal').forEach(modal => modal.setAttribute('inert', ''));

$$('[data-open-booking]').forEach(button => button.addEventListener('click', () => {
  if (!$('#bookingSuccess').hidden) resetBookingForm();
  syncBookingLanguageToSite();
  openModal(bookingModal);
}));
$$('[data-open-scanner]').forEach(button => button.addEventListener('click', () => {
  const selectedSiteLanguage = $('#languageSelect').value;
  if (selectedSiteLanguage !== 'de') $('#targetLanguage').value = selectedSiteLanguage;
  openModal(scannerModal);
}));
$$('[data-close-modal]').forEach(button => button.addEventListener('click', closeModals));

const DEFAULT_LOCATION = {
  id: 'limburg',
  city: 'Limburg',
  name: 'Caritashaus Limburg',
  address: 'Schiede 73, 65549 Limburg',
  phone: '06431 2005-0',
  phoneHref: '+49643120050',
  coordinates: [50.3874, 8.0617],
  website: 'https://www.caritas-limburg.de/'
};
const DEFAULT_APPOINTMENT_LOCATION = `${DEFAULT_LOCATION.name}, ${DEFAULT_LOCATION.address}`;
let confirmedAppointment = null;

function formatSlotDate(date) {
  const locale = { de: 'de-DE', en: 'en-GB', ar: 'ar', tr: 'tr-TR', uk: 'uk-UA' }[currentSiteLanguage] || 'de-DE';
  return new Intl.DateTimeFormat(locale, { weekday: 'short', day: '2-digit', month: 'short' })
    .format(date)
    .replaceAll('.', '')
    .toUpperCase();
}

function initializeSlots() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  $$('.slot').forEach((slot) => {
    const date = new Date(today);
    date.setDate(today.getDate() + Number(slot.dataset.offset));
    while (date.getDay() === 0 || date.getDay() === 6) date.setDate(date.getDate() + 1);
    slot.dataset.date = date.toISOString().slice(0, 10);
    $('small', slot).textContent = formatSlotDate(date);
  });
}

function selectedMode() {
  return $('.choice.active')?.dataset.mode || 'Video';
}

function updateModeInfo() {
  const mode = selectedMode();
  const modeInfo = $('#modeInfo');
  const phone = $('#bookingPhone');
  const phoneGroup = $('#phoneGroup');
  const directions = $('#openDirections');
  phoneGroup.hidden = mode !== 'Telefon';
  phone.required = mode === 'Telefon';
  directions.hidden = mode !== 'Vor Ort';

  if (mode === 'Vor Ort') {
    modeInfo.innerHTML = `<strong>${DEFAULT_LOCATION.name}</strong><span>${DEFAULT_LOCATION.address}</span><small>Telefon ${DEFAULT_LOCATION.phone}</small>`;
  } else if (mode === 'Telefon') {
    modeInfo.innerHTML = '<strong>Telefonberatung</strong><span>Wir rufen dich zur ausgewählten Uhrzeit an.</span>';
  } else {
    modeInfo.innerHTML = '<strong>Videoberatung</strong><span>Der sichere Zugangslink wird mit der Terminbestätigung verschickt.</span>';
  }
  translateDynamicSection(modeInfo);
}

$$('.choice').forEach(button => button.addEventListener('click', () => {
  $$('.choice').forEach(item => {
    item.classList.remove('active');
    item.setAttribute('aria-pressed', 'false');
  });
  button.classList.add('active');
  button.setAttribute('aria-pressed', 'true');
  updateModeInfo();
}));
$$('.slot').forEach(button => button.addEventListener('click', () => {
  $$('.slot').forEach(item => {
    item.classList.remove('active');
    item.setAttribute('aria-pressed', 'false');
  });
  button.classList.add('active');
  button.setAttribute('aria-pressed', 'true');
}));

function setBookingBusy(isBusy) {
  const button = $('#confirmBooking');
  button.disabled = isBusy;
  button.innerHTML = isBusy ? '<span class="button-loader"></span> Anfrage wird gesendet …' : 'Terminanfrage absenden <span>→</span>';
  translateDynamicSection(button);
}

function appointmentDescription(appointment) {
  const date = new Date(`${appointment.date}T12:00:00`);
  const locale = { de: 'de-DE', en: 'en-GB', ar: 'ar', tr: 'tr-TR', uk: 'uk-UA' }[currentSiteLanguage] || 'de-DE';
  const readableDate = new Intl.DateTimeFormat(locale, { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' }).format(date);
  const place = appointment.mode === 'Vor Ort' ? ` · Vor Ort: ${appointment.location}` : '';
  const reference = appointment.bookingId ? ` · Vorgangsnummer ${appointment.bookingId}` : '';
  return `${appointment.topic} am ${readableDate} um ${appointment.time} Uhr · ${appointment.mode} · Gesprächssprache: ${appointment.preferredLanguage}${place}${reference}`;
}

const bookingLanguageDefaults = { de: 'Deutsch', en: 'English', ar: 'العربية', tr: 'Türkçe', uk: 'Українська' };
const bookingConversationLanguage = $('#bookingConversationLanguage');
const bookingOtherLanguage = $('#bookingOtherLanguage');

function updateOtherLanguageField() {
  const usesOtherLanguage = bookingConversationLanguage.value === 'Andere Sprache';
  $('#bookingOtherLanguageGroup').hidden = !usesOtherLanguage;
  bookingOtherLanguage.required = usesOtherLanguage;
  if (!usesOtherLanguage) bookingOtherLanguage.value = '';
}

function syncBookingLanguageToSite(force = false) {
  if (force || bookingConversationLanguage.dataset.userChanged !== 'true') {
    bookingConversationLanguage.value = bookingLanguageDefaults[currentSiteLanguage] || 'Deutsch';
  }
  updateOtherLanguageField();
}

bookingConversationLanguage.addEventListener('change', () => {
  bookingConversationLanguage.dataset.userChanged = 'true';
  updateOtherLanguageField();
});

$('#bookingForm').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const errorBox = $('#bookingError');
  errorBox.hidden = true;

  if (!form.reportValidity()) return;
  const slot = $('.slot.active');
  const appointment = {
    name: $('#bookingName').value.trim(),
    email: $('#bookingEmail').value.trim(),
    phone: $('#bookingPhone').value.trim(),
    topic: $('#bookingTopic').value,
    topicLabel: $('#bookingTopic').selectedOptions[0]?.textContent.trim() || $('#bookingTopic').value,
    mode: selectedMode(),
    date: slot.dataset.date,
    time: slot.dataset.time,
    location: selectedMode() === 'Vor Ort' ? DEFAULT_APPOINTMENT_LOCATION : '',
    language: currentSiteLanguage,
    preferredLanguage: bookingConversationLanguage.value === 'Andere Sprache' ? bookingOtherLanguage.value.trim() : bookingConversationLanguage.value,
    accessibilityNeeds: $('#bookingAccessibilityNeeds').value.trim(),
    consent: $('#bookingConsent').checked,
    website: $('#bookingWebsite').value
  };

  setBookingBusy(true);
  let emailSent = false;
  let testMode = false;
  let statusMessage = '';
  if (IS_GITHUB_PAGES) {
    appointment.bookingId = `GH-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
    statusMessage = 'Die öffentliche GitHub-Version kann keine E-Mails automatisch versenden. Die Termindaten bleiben auf diesem Gerät und können als Kalenderdatei gespeichert werden.';
  } else {
    try {
      const response = await fetch(`${API_BASE_URL}/api/appointments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(appointment)
      });
      const result = await response.json().catch(() => ({}));
      emailSent = response.ok && result.emailSent === true;
      testMode = response.ok && result.testMode === true;
      statusMessage = result.error || '';
      appointment.bookingId = result.bookingId || '';
    } catch {
      statusMessage = 'Der E-Mail-Dienst ist momentan nicht erreichbar.';
    }
  }
  setBookingBusy(false);

  confirmedAppointment = appointment;
  $('#bookingSummary').textContent = appointmentDescription(appointment);
  const emailStatus = $('#emailStatus');
  if (emailSent) {
    $('#bookingSuccessTitle').textContent = testMode ? 'Test-E-Mail versendet' : 'Terminanfrage versendet';
    emailStatus.className = 'email-status sent';
    emailStatus.innerHTML = testMode
      ? '<strong>✓ Testversand erfolgreich</strong><span>Die E-Mail wurde ausschließlich an die hinterlegte Resend-Testadresse geschickt. Die eingegebene Besucheradresse wurde nicht angeschrieben.</span>'
      : `<strong>✓ E-Mail versendet</strong><span>Die Bestätigung wurde an ${appointment.email} geschickt.</span>`;
  } else {
    $('#bookingSuccessTitle').textContent = 'Terminanfrage nicht versendet';
    emailStatus.className = 'email-status pending';
    emailStatus.innerHTML = `<strong>Bestätigungs-E-Mail noch nicht versendet</strong><span>${statusMessage || 'Der Versand ist noch nicht eingerichtet.'} Die Termindaten bleiben auf diesem Gerät gespeichert.</span>`;
  }
  translateDynamicSection($('#bookingSuccess'));
  $('#bookingFormView').hidden = true;
  $('#bookingSuccess').hidden = false;
  $('#bookingSuccess').focus();
});

function toIcsDate(date, time) {
  return `${date.replaceAll('-', '')}T${time.replace(':', '')}00`;
}

$('#downloadCalendar').addEventListener('click', () => {
  if (!confirmedAppointment) return;
  const start = new Date(`${confirmedAppointment.date}T${confirmedAppointment.time}:00`);
  const end = new Date(start.getTime() + 60 * 60 * 1000);
  const endDate = `${end.getFullYear()}-${String(end.getMonth() + 1).padStart(2, '0')}-${String(end.getDate()).padStart(2, '0')}`;
  const endTime = `${String(end.getHours()).padStart(2, '0')}:${String(end.getMinutes()).padStart(2, '0')}`;
  const ics = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Caritas Wegweiser//DE', 'BEGIN:VEVENT',
    `UID:${crypto.randomUUID()}@caritas-wegweiser.de`,
    `DTSTAMP:${new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')}`,
    `DTSTART:${toIcsDate(confirmedAppointment.date, confirmedAppointment.time)}`,
    `DTEND:${toIcsDate(endDate, endTime)}`,
    `SUMMARY:${confirmedAppointment.topic} – Caritas Wegweiser`,
    `DESCRIPTION:Beratungsart: ${confirmedAppointment.mode}; Gesprächssprache: ${confirmedAppointment.preferredLanguage} (Projekt-Demonstration)`,
    `LOCATION:${confirmedAppointment.location || 'Online / telefonisch'}`,
    'END:VEVENT', 'END:VCALENDAR'
  ].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  link.download = 'caritas-termin.ics';
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

function resetBookingForm() {
  $('#bookingForm').reset();
  delete bookingConversationLanguage.dataset.userChanged;
  syncBookingLanguageToSite(true);
  $$('.choice').forEach((item, index) => {
    item.classList.toggle('active', index === 0);
    item.setAttribute('aria-pressed', String(index === 0));
  });
  $$('.slot').forEach((item, index) => {
    item.classList.toggle('active', index === 0);
    item.setAttribute('aria-pressed', String(index === 0));
  });
  $('#bookingSuccess').hidden = true;
  $('#bookingFormView').hidden = false;
  updateModeInfo();
}

$('#bookAnother').addEventListener('click', resetBookingForm);

initializeSlots();
updateModeInfo();

const menuButton = $('#menuButton');
const mobileMenu = $('#mobileMenu');
menuButton.addEventListener('click', () => {
  const isOpen = mobileMenu.classList.toggle('open');
  menuButton.setAttribute('aria-expanded', String(isOpen));
  mobileMenu.setAttribute('aria-hidden', String(!isOpen));
  mobileMenu.toggleAttribute('inert', !isOpen);
  if (isOpen) setTimeout(() => $('a', mobileMenu)?.focus(), 20);
});
$$('a', mobileMenu).forEach(link => link.addEventListener('click', () => {
  mobileMenu.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  mobileMenu.setAttribute('aria-hidden', 'true');
  mobileMenu.setAttribute('inert', '');
}));

const guideCopy = {
  finanzen: {
    category: 'Finanzen · Lesetipp',
    shortCategory: 'Finanzen',
    icon: '€',
    title: 'Bescheide und Geldsorgen: Erste Schritte',
    intro: 'Diese Schritte helfen dir, Ruhe in die Situation zu bringen und eine Beratung gut vorzubereiten.',
    steps: ['Öffne Briefe zeitnah und markiere jede genannte Frist.', 'Lege Bescheide, Mahnungen, Einkommensnachweise und Kontoauszüge zusammen.', 'Notiere, was unklar ist und welche Zahlung als Nächstes fällig wird.', 'Unterschreibe nichts, was du nicht verstanden hast. Hole vorher Beratung ein.']
  },
  familie: {
    category: 'Familie & Kinder · Lesetipp',
    shortCategory: 'Familie & Kinder',
    icon: '⌁',
    title: 'Unterstützung für Familien finden',
    intro: 'Du musst nicht schon genau wissen, welche Hilfe du brauchst. Eine kurze Vorbereitung macht das erste Beratungsgespräch leichter.',
    steps: ['Schreibe in einem Satz auf, was dich oder deine Familie im Moment am meisten belastet.', 'Notiere wichtige Termine, Schreiben und bereits geführte Gespräche.', 'Sammle nur die Unterlagen, die zu deinem Anliegen gehören. Originale solltest du bei dir behalten.', 'Gib bei der Terminanfrage an, in welcher Sprache das Gespräch stattfinden soll und ob du weitere Unterstützung brauchst.', 'Wenn ein Kind oder eine andere Person akut gefährdet ist, nutze sofort die örtliche Notruf- oder Krisenhilfe.']
  },
  wohnen: {
    category: 'Wohnen & Notfall · Lesetipp',
    shortCategory: 'Wohnen & Notfall',
    icon: '⌂',
    title: 'Probleme mit Miete oder Wohnung',
    intro: 'Bei Mietproblemen ist eine nachvollziehbare Dokumentation besonders wichtig.',
    steps: ['Bewahre Mietvertrag, Schreiben und Zahlungsnachweise auf.', 'Fotografiere Schäden mit Datum, ohne andere Personen abzubilden.', 'Antworte auf Kündigungen oder gerichtliche Schreiben nicht verspätet.', 'Vereinbare nichts nur mündlich – bitte um eine schriftliche Bestätigung.', 'Bei drohendem Wohnungsverlust solltest du möglichst sofort Beratung suchen.']
  },
  migration: {
    category: 'Migration & Integration · Lesetipp',
    shortCategory: 'Migration & Integration',
    icon: '◎',
    title: 'Ankommen und Orientierung finden',
    intro: 'Geordnete Dokumente und eine passende Gesprächssprache helfen dabei, Aufenthalt, Alltag und nächste Schritte gemeinsam zu klären.',
    steps: ['Lege Ausweis, Aufenthaltspapiere, Schreiben von Behörden und vorhandene Übersetzungen zusammen.', 'Markiere Fristen und Termine. Bei unklaren Schreiben solltest du möglichst früh fachkundige Beratung suchen.', 'Gib vor dem Termin an, welche Sprache du am besten verstehst und ob eine Sprachmittlung benötigt wird.', 'Notiere deine wichtigsten Fragen zu Aufenthalt, Arbeit, Schule, Wohnen oder Leistungen.', 'Gib Originaldokumente nur ab, wenn es erforderlich ist, und bitte immer um eine Empfangsbestätigung.']
  },
  gesundheit: {
    category: 'Gesundheit & Pflege · Lesetipp',
    shortCategory: 'Gesundheit & Pflege',
    icon: '＋',
    title: 'Gespräche und Pflege gut vorbereiten',
    intro: 'Eine übersichtliche Liste hilft Ärztinnen, Ärzten und Beratungsstellen, deine Situation schneller zu verstehen.',
    steps: ['Notiere Beschwerden, Diagnosen, Medikamente und Allergien so genau wie möglich.', 'Schreibe deine wichtigsten Fragen vor dem Termin auf und nimm vorhandene Befunde mit.', 'Bitte bei Verständigungsproblemen frühzeitig um Sprachmittlung oder eine andere barrierefreie Unterstützung.', 'Beschreibe bei Pflegefragen ehrlich, was im Alltag allein gelingt und wobei Hilfe nötig ist.', 'Bei akuten oder lebensbedrohlichen Beschwerden rufst du sofort den Notruf 112.']
  }
};

const CARITAS_LOCATIONS = [
  DEFAULT_LOCATION,
  { id: 'hamburg', city: 'Hamburg', name: 'Caritas im Norden - Landesstelle Hamburg', address: 'Danziger Straße 66, 20099 Hamburg', phone: '+49 40 280140-0', phoneHref: '+49402801400', coordinates: [53.5552, 10.0143], website: 'https://www.caritas-im-norden.de/' },
  { id: 'berlin', city: 'Berlin', name: 'Caritasverband für das Erzbistum Berlin', address: 'Residenzstraße 90, 13409 Berlin', phone: '+49 30 66633-0', phoneHref: '+4930666330', coordinates: [52.5662, 13.3818], website: 'https://www.caritas-berlin.de/' },
  { id: 'hannover', city: 'Hannover', name: 'Caritasverband Hannover', address: 'Leibnizufer 13-15, 30169 Hannover', phone: '+49 511 12600-0', phoneHref: '+49511126000', coordinates: [52.3714, 9.7291], website: 'https://www.caritas-hannover.de/' },
  { id: 'leipzig', city: 'Leipzig', name: 'Caritasverband Leipzig', address: 'Elsterstraße 15, 04109 Leipzig', phone: '+49 341 96361-0', phoneHref: '+49341963610', coordinates: [51.3398, 12.3662], website: 'https://www.caritas-leipzig.de/' },
  { id: 'koeln', city: 'Köln', name: 'Caritasverband für die Stadt Köln', address: 'Bartholomäus-Schink-Straße 6, 50825 Köln', phone: '+49 221 95570-0', phoneHref: '+49221955700', coordinates: [50.9519, 6.9167], website: 'https://www.caritas-koeln.de/' },
  { id: 'frankfurt', city: 'Frankfurt am Main', name: 'Caritasverband Frankfurt', address: 'Alte Mainzer Gasse 10, 60311 Frankfurt am Main', phone: '+49 69 2982-0', phoneHref: '+496929820', coordinates: [50.1106, 8.6822], website: 'https://www.caritas-frankfurt.de/' },
  { id: 'stuttgart', city: 'Stuttgart', name: 'Caritasverband für Stuttgart', address: 'Strombergstraße 11, 70188 Stuttgart', phone: '+49 711 2809-0', phoneHref: '+4971128090', coordinates: [48.7901, 9.2021], website: 'https://www.caritas-stuttgart.de/' },
  { id: 'freiburg', city: 'Freiburg', name: 'Deutscher Caritasverband', address: 'Karlstraße 40, 79104 Freiburg im Breisgau', phone: '+49 761 200-0', phoneHref: '+497612000', coordinates: [48.0014, 7.8552], website: 'https://www.caritas.de/' },
  { id: 'muenchen', city: 'München', name: 'Caritas München und Oberbayern', address: 'Hirtenstraße 4, 80335 München', phone: '+49 89 55169-0', phoneHref: '+4989551690', coordinates: [48.1426, 11.5577], website: 'https://www.caritasmuenchen-region.de/' }
];

let locationMap = null;
const locationMarkers = new Map();

function normalizeLocationQuery(value) {
  return String(value || '').toLocaleLowerCase('de-DE').normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
}

function locationMatches(location, query) {
  if (!query) return true;
  return normalizeLocationQuery(`${location.city} ${location.name} ${location.address}`).includes(query);
}

function setActiveLocation(id) {
  $$('.location-card').forEach(card => card.classList.toggle('active', card.dataset.locationId === id));
}

function focusLocation(id) {
  const location = CARITAS_LOCATIONS.find(item => item.id === id);
  if (!location) return;
  setActiveLocation(id);
  ensureLocationMap();
  const marker = locationMarkers.get(id);
  if (locationMap && marker) {
    locationMap.flyTo(location.coordinates, 13, { animate: !document.body.classList.contains('reduce-motion'), duration: 1.15 });
    setTimeout(() => marker.openPopup(), document.body.classList.contains('reduce-motion') ? 0 : 700);
  }
}

function locationCard(location, index) {
  return `
    <article class="location-card" data-location-id="${location.id}">
      <div class="location-card-top"><span>${String(index + 1).padStart(2, '0')}</span><strong class="notranslate" translate="no">${location.city}</strong></div>
      <h4 class="notranslate" translate="no">${location.name}</h4>
      <p class="notranslate" translate="no">${location.address}</p>
      <div class="location-card-actions">
        <button class="text-button" type="button" data-focus-location="${location.id}">Auf Karte zeigen</button>
        <a href="tel:${location.phoneHref}" aria-label="${location.name} anrufen">${location.phone}</a>
        <a href="${location.website}" target="_blank" rel="noopener">Website ↗</a>
      </div>
    </article>`;
}

function renderLocationList() {
  const search = $('#locationSearch');
  const query = normalizeLocationQuery(search.value);
  const matches = CARITAS_LOCATIONS.filter(location => locationMatches(location, query));
  $('#locationList').innerHTML = matches.map((location, index) => locationCard(location, CARITAS_LOCATIONS.indexOf(location))).join('');
  $('#locationCount').textContent = `${matches.length} ${matches.length === 1 ? 'Standort' : 'Standorte'}`;
  $('#locationEmpty').hidden = matches.length > 0;
  $('#resetLocationSearch').hidden = !query;

  $$('[data-focus-location]', $('#locationList')).forEach(button => button.addEventListener('click', () => focusLocation(button.dataset.focusLocation)));
  locationMarkers.forEach((marker, id) => {
    const visible = matches.some(location => location.id === id);
    if (locationMap && visible && !locationMap.hasLayer(marker)) marker.addTo(locationMap);
    if (locationMap && !visible && locationMap.hasLayer(marker)) marker.removeFrom(locationMap);
  });
}

function ensureLocationMap() {
  if (locationMap) {
    setTimeout(() => locationMap.invalidateSize({ animate: false }), 0);
    return;
  }
  const mapElement = $('#caritasMap');
  if (!mapElement || !window.L) {
    if (mapElement) mapElement.innerHTML = '<div class="map-fallback"><span aria-hidden="true">⌖</span><strong>Die Karte konnte nicht geladen werden.</strong><small>Die Standortliste bleibt vollständig nutzbar.</small></div>';
    return;
  }

  mapElement.replaceChildren();
  locationMap = window.L.map(mapElement, { scrollWheelZoom: false, zoomControl: true }).setView(DEFAULT_LOCATION.coordinates, 13);
  window.L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 18,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>'
  }).addTo(locationMap);

  CARITAS_LOCATIONS.forEach((location, index) => {
    const marker = window.L.marker(location.coordinates, {
      title: `${location.name}, ${location.city}`,
      keyboard: true,
      icon: window.L.divIcon({
        className: 'caritas-map-marker',
        html: `<span style="--marker-delay:${index * 0.08}s"><b>${index + 1}</b></span>`,
        iconSize: [42, 48],
        iconAnchor: [21, 45],
        popupAnchor: [0, -42]
      })
    });
    marker.bindPopup(`<div class="map-popup"><strong>${location.name}</strong><span>${location.address}</span><a href="tel:${location.phoneHref}">${location.phone}</a><a href="${location.website}" target="_blank" rel="noopener">Website öffnen ↗</a></div>`);
    marker.on('click', () => setActiveLocation(location.id));
    marker.addTo(locationMap);
    locationMarkers.set(location.id, marker);
  });

  renderLocationList();
  setActiveLocation(DEFAULT_LOCATION.id);
  locationMarkers.get(DEFAULT_LOCATION.id)?.openPopup();
}

$('#locationSearch').addEventListener('input', renderLocationList);
$('#resetLocationSearch').addEventListener('click', () => {
  $('#locationSearch').value = '';
  renderLocationList();
  $('#locationSearch').focus();
  if (locationMap) {
    const bounds = window.L.latLngBounds(CARITAS_LOCATIONS.map(location => location.coordinates));
    locationMap.fitBounds(bounds, { padding: [34, 34], maxZoom: 6 });
  }
});
renderLocationList();

const routePages = ['start', 'standorte', 'dokumente', 'hilfe', 'tipps', 'tipp', 'kontakt', 'soforthilfe'];
const routeTitles = {
  start: 'Caritas Wegweiser',
  standorte: 'Standorte – Caritas Wegweiser',
  dokumente: 'Dokumente – Caritas Wegweiser',
  hilfe: 'Praktische Hilfen – Caritas Wegweiser',
  tipps: 'Tipps – Caritas Wegweiser',
  tipp: 'Tipp – Caritas Wegweiser',
  kontakt: 'Kontakt – Caritas Wegweiser',
  soforthilfe: 'Soforthilfe – Caritas Wegweiser'
};

function currentRoute() {
  const value = location.hash.replace(/^#\/?/, '').split('?')[0];
  const guideMatch = value.match(/^tipps\/([a-z]+)$/);
  if (guideMatch && guideCopy[guideMatch[1]]) return { page: 'tipp', guide: guideMatch[1] };
  if (value === 'wissen') return { page: 'tipps', guide: null };
  if (value === 'beratung') return { page: 'standorte', guide: null };
  return { page: routePages.includes(value) && value !== 'tipp' ? value : 'start', guide: null };
}

function renderGuidePage(slug) {
  const guide = guideCopy[slug];
  if (!guide) return;
  $('#guideBreadcrumb').textContent = guide.shortCategory;
  $('#guidePageIcon').textContent = guide.icon;
  $('#guidePageCategory').textContent = guide.category;
  $('#guidePageTitle').textContent = guide.title;
  $('#guidePageIntro').textContent = guide.intro;
  const list = $('#guidePageSteps');
  list.replaceChildren(...guide.steps.map(step => {
    const item = document.createElement('li');
    item.textContent = step;
    return item;
  }));
}

function renderRoute({ scroll = true } = {}) {
  const { page: route, guide } = currentRoute();
  if (route === 'tipp') renderGuidePage(guide);
  document.body.classList.add('route-ready');
  $$('.route-page').forEach(section => section.classList.toggle('route-active', section.dataset.page === route));
  $$('[data-nav-page]').forEach(link => {
    const active = link.dataset.navPage === (route === 'tipp' ? 'tipps' : route);
    link.classList.toggle('active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
  document.title = route === 'tipp' ? `${guideCopy[guide].title} – Caritas Wegweiser` : routeTitles[route];
  $$('.route-active .reveal').forEach(element => element.classList.add('visible'));
  if (route === 'tipp') translateDynamicSection($('#tipp'));
  if (route === 'standorte') setTimeout(ensureLocationMap, 0);
  mobileMenu.classList.remove('open');
  menuButton.setAttribute('aria-expanded', 'false');
  mobileMenu.setAttribute('aria-hidden', 'true');
  mobileMenu.setAttribute('inert', '');
  if (scroll) {
    const heading = $('.route-active h1, .route-active h2');
    const announcement = route === 'tipp' ? guideCopy[guide].title : routeTitles[route].replace(' – Caritas Wegweiser', '');
    $('#routeAnnouncer').textContent = `Seite geladen: ${announcement}`;
    if (heading) {
      heading.setAttribute('tabindex', '-1');
      heading.focus({ preventScroll: true });
    }
    window.scrollTo({ top: 0, behavior: document.body.classList.contains('reduce-motion') ? 'auto' : 'smooth' });
  }
}

window.addEventListener('hashchange', () => {
  stopPageReading(false);
  renderRoute();
});
renderRoute({ scroll: false });

function openAi(prefill = '') {
  lastAiFocusedElement = document.activeElement?.closest?.('.modal') ? lastFocusedElement : (document.activeElement instanceof HTMLElement ? document.activeElement : null);
  closeModals({ restoreFocus: false });
  aiPanel.classList.add('open');
  aiPanel.setAttribute('aria-hidden', 'false');
  aiPanel.removeAttribute('inert');
  translateDynamicSection(aiPanel);
  if (prefill) $('#aiInput').value = prefill;
  setTimeout(() => $('#aiInput').focus(), 300);
}
$$('[data-open-ai]').forEach(button => button.addEventListener('click', () => openAi()));
function closeAi({ restoreFocus = true } = {}) {
  aiPanel.classList.remove('open');
  aiPanel.setAttribute('aria-hidden', 'true');
  aiPanel.setAttribute('inert', '');
  if (restoreFocus && lastAiFocusedElement?.isConnected) lastAiFocusedElement.focus();
}
$('#closeAi').addEventListener('click', () => closeAi());

const aiConversation = [];
let aiIsBusy = false;

const localAssistantTopics = [
  { words: ['notfall', 'gefahr', 'suizid', 'selbstmord', '112'], reply: 'Wenn du oder eine andere Person akut in Gefahr seid, rufe sofort 112 an. Bei einer dringenden sozialen Krise öffne auf dieser Website „Soforthilfe“. Der Assistent ersetzt keinen Notdienst.' },
  { words: ['termin', 'buchen', 'beratungsgespräch', 'appointment', 'randevu', 'موعد', 'зустріч'], reply: 'Einen Beratungstermin kannst du über „Termin buchen“ anfragen. Wähle Thema, Video, Telefon oder Vor Ort, Datum und Uhrzeit. Gib außerdem deine bevorzugte Gesprächssprache und mögliche Unterstützungsbedarfe an.' },
  { words: ['übersetz', 'uebersetz', 'dokument', 'brief', 'kamera', 'foto', 'scan', 'translate', 'ترجم', 'переклад'], reply: 'Öffne „Dokumente“ und dann den Dokument-Übersetzer. Du kannst ein Foto aufnehmen oder ein Bild, PDF oder eine Textdatei auswählen. Prüfe Namen, Fristen und Geldbeträge anschließend sorgfältig.' },
  { words: ['sprache', 'dolmetsch', 'language', 'interpreter', 'لغة', 'мова'], reply: 'Die Website kann oben auf Deutsch, Englisch, Arabisch, Türkisch oder Ukrainisch angezeigt werden. Bei einer Terminanfrage kannst du zusätzlich deine bevorzugte Gesprächssprache angeben.' },
  { words: ['barriere', 'blind', 'rollstuhl', 'leichte sprache', 'accessib', 'إعاقة', 'доступн'], reply: 'Über das Barrierefreiheits-Symbol oben rechts kannst du die Vorlesefunktion, größere Schrift, hohen Kontrast, weniger Bewegung und eine vereinfachte Ansicht aktivieren.' },
  { words: ['geld', 'schulden', 'finanz', 'arbeit', 'arbeitslos', 'job', 'ديون', 'борг'], reply: 'Bei Fragen zu Geld, Schulden, Arbeit oder Arbeitslosigkeit wähle „Arbeit & Finanzen“. Dort findest du erste Hinweise und kannst einen Beratungstermin anfragen.' },
  { words: ['familie', 'kind', 'schwanger', 'erziehung', 'family', 'طفل', 'дитин'], reply: 'Bei Fragen zu Familie, Kindern, Schwangerschaft oder Erziehung wähle „Familie & Erziehung“.' },
  { words: ['wohnung', 'miete', 'vermieter', 'obdach', 'housing', 'rent', 'سكن', 'житл'], reply: 'Bei Problemen mit Wohnung, Miete oder drohendem Wohnungsverlust wähle „Wohnen & Existenz“. Bei akuter Obdachlosigkeit öffne bitte zusätzlich „Soforthilfe“.' },
  { words: ['migration', 'asyl', 'aufenthalt', 'refugee', 'لجوء', 'міграц'], reply: 'Bei Fragen zu Migration, Asyl oder Aufenthalt wähle „Migration & Integration“. Bringe vorhandene Schreiben und Dokumente möglichst zum Beratungsgespräch mit.' },
  { words: ['gesund', 'pflege', 'krank', 'arzt', 'health', 'صحة', 'здоров'], reply: 'Bei Fragen zu Gesundheit, Krankheit oder Pflege wähle „Gesundheit & Pflege“. Der Assistent gibt keine medizinische Diagnose. Im Notfall rufe 112 an.' },
  { words: ['kontakt', 'email', 'e-mail', 'telefon', 'adresse', 'öffnungszeit', 'contact', 'عنوان', 'адрес'], reply: 'Die Kontaktmöglichkeiten findest du auf der Seite „Kontakt“. Für eine konkrete Beratung ist „Termin buchen“ der schnellste Weg.' },
  { words: ['hallo', 'guten tag', 'hello', 'merhaba', 'مرحبا', 'привіт'], reply: 'Hallo! Ich helfe dir bei Fragen zu Terminen, Dokumenten, Beratung, Sprachen, Barrierefreiheit, Kontakt und Soforthilfe. Nenne einfach dein Thema.' }
];

function localAssistantReply(question) {
  const normalized = question.toLocaleLowerCase('de-DE').normalize('NFD').replace(/\p{Diacritic}/gu, '');
  const topic = localAssistantTopics.find(item => item.words.some(word => normalized.includes(word.normalize('NFD').replace(/\p{Diacritic}/gu, ''))));
  return topic?.reply || 'Dazu habe ich noch keine feste Antwort. Frage bitte nach Termin, Dokumentübersetzung, Sprache, Barrierefreiheit, Kontakt, Finanzen, Familie, Wohnen, Migration, Gesundheit oder Soforthilfe.';
}

function addMessage(text, type = 'user') {
  const message = document.createElement('div');
  message.className = `message ${type}`;
  if (type === 'assistant') message.innerHTML = '<span class="message-avatar">✦</span>';
  const bubble = document.createElement('div');
  const paragraph = document.createElement('p');
  paragraph.textContent = text;
  bubble.appendChild(paragraph);
  message.appendChild(bubble);
  $('#aiMessages').appendChild(message);
  if (type.includes('assistant')) translateDynamicSection(message);
  $('#aiMessages').scrollTop = $('#aiMessages').scrollHeight;
  return message;
}

function setAiBusy(isBusy) {
  aiIsBusy = isBusy;
  $('#aiInput').disabled = isBusy;
  $('#aiSubmit').disabled = isBusy;
  $('#aiMessages').setAttribute('aria-busy', String(isBusy));
}

async function handleAiMessage(text) {
  const question = text.trim();
  if (!question || aiIsBusy) return;
  addMessage(question);
  aiConversation.push({ role: 'user', content: question });
  $('#aiInput').value = '';
  setAiBusy(true);
  const thinking = addMessage('Antwort wird erstellt …', 'assistant thinking');
  try {
    let reply;
    if (IS_GITHUB_PAGES) {
      reply = localAssistantReply(question);
    } else {
      const response = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: aiConversation.slice(-10) })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.reply) throw new Error(result.error || 'Die KI konnte gerade nicht antworten.');
      reply = result.reply;
    }
    aiConversation.push({ role: 'assistant', content: reply });
    thinking.remove();
    addMessage(reply, 'assistant');
  } catch (error) {
    thinking.remove();
    addMessage(error.message || 'Die KI ist momentan nicht erreichbar. Bitte versuche es später erneut.', 'assistant');
  } finally {
    setAiBusy(false);
    $('#aiInput').focus();
  }
}

$('#aiForm').addEventListener('submit', event => { event.preventDefault(); handleAiMessage($('#aiInput').value); });

const sourceLanguage = $('#sourceLanguage');
const targetLanguage = $('#targetLanguage');
const sourceText = $('#sourceText');
const translateButton = $('#translateText');
const cameraButton = $('#startCamera');
const languageNames = { de: 'Deutsch', en: 'English', ar: 'العربية', tr: 'Türkçe', uk: 'Українська', fr: 'Français', es: 'Español', it: 'Italiano', pl: 'Polski', ru: 'Русский', fa: 'فارسی' };
const textEncoder = new TextEncoder();
const RTL_DOCUMENT_LANGUAGES = new Set(['ar', 'fa']);

function updateCharacterCount() {
  $('#characterCount').textContent = `${sourceText.value.length.toLocaleString('de-DE')} / 5.000 Zeichen`;
}

function setSourceText(value) {
  const original = String(value || '').trim();
  sourceText.value = original.slice(0, 5000);
  sourceText.dir = RTL_DOCUMENT_LANGUAGES.has(sourceLanguage.value) ? 'rtl' : 'auto';
  if (original.length > 5000) showToast('Für die Übersetzung wurden die ersten 5.000 Zeichen übernommen.');
  updateCharacterCount();
}

function showTranslatorError(message) {
  const errorBox = $('#translatorError');
  errorBox.textContent = message;
  errorBox.classList.remove('hidden');
  $('#scanStatus').classList.add('hidden');
}

function clearTranslatorMessages() {
  $('#translatorError').classList.add('hidden');
  $('#scanResult').classList.add('hidden');
}

function setScanStatus(title, detail, progress = 0) {
  $('#scanStatusTitle').textContent = title;
  $('#scanStatusDetail').textContent = detail;
  $('#scanProgress').value = Math.max(0, Math.min(100, Math.round(progress)));
  $('#scanStatus').classList.remove('hidden');
  $('#translatorError').classList.add('hidden');
}

function setTranslatorBusy(isBusy) {
  translateButton.disabled = isBusy;
  cameraButton.disabled = isBusy;
  $('#documentInput').disabled = isBusy;
  $('#swapLanguages').disabled = isBusy;
}

function splitTranslationText(text) {
  const chunks = [];
  let current = '';
  const parts = text.match(/\S+\s*/gu) || [text];

  for (const part of parts) {
    if (textEncoder.encode(part).length > 450) {
      if (current) chunks.push(current);
      current = '';
      for (const character of part) {
        if (textEncoder.encode(current + character).length > 450) {
          chunks.push(current);
          current = character;
        } else {
          current += character;
        }
      }
    } else if (textEncoder.encode(current + part).length > 450) {
      if (current) chunks.push(current);
      current = part;
    } else {
      current += part;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function decodeTranslation(value) {
  const textarea = document.createElement('textarea');
  textarea.innerHTML = value;
  return textarea.value;
}

async function translateChunk(chunk, source, target) {
  if (!chunk.trim()) return chunk;
  if (IS_GITHUB_PAGES) {
    if (!$('#translationConsent')?.checked) throw new Error('Bitte stimme zuerst der Textübertragung an MyMemory zu.');
    const url = new URL('https://api.mymemory.translated.net/get');
    url.searchParams.set('q', chunk);
    url.searchParams.set('langpair', source + '|' + target);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
      const data = await response.json();
      if (response.status === 429 || Number(data.responseStatus) === 429 || data.quotaFinished) {
        throw new Error('Das kostenlose Übersetzungslimit ist erreicht. Bitte versuche es später erneut.');
      }
      if (!response.ok || Number(data.responseStatus) !== 200 || !data.responseData?.translatedText) {
        throw new Error('Der Übersetzungsdienst konnte diesen Text nicht übersetzen. Bitte prüfe die Sprachen und versuche es später erneut.');
      }
      return decodeTranslation(data.responseData.translatedText);
    } catch (error) {
      if (error.name === 'AbortError') throw new Error('Die Übersetzung dauert zu lange. Bitte versuche es erneut.');
      if (error instanceof TypeError) throw new Error('Der Übersetzungsdienst ist nicht erreichbar. Bitte prüfe deine Internetverbindung.');
      throw error;
    } finally { clearTimeout(timeout); }
  }
  const response = await fetch(`${API_BASE_URL}/api/translate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: chunk, source, target })
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data?.translatedText) throw new Error(data?.error || 'Der Übersetzungsdienst antwortet gerade nicht.');
  return decodeTranslation(data.translatedText);
}

async function translateTextInBrowser(text, source, target) {
  if (source === target) return text;
  const chunks = splitTranslationText(text);
  const translated = [];
  for (let index = 0; index < chunks.length; index += 3) {
    translated.push(...await Promise.all(chunks.slice(index, index + 3).map(chunk => translateChunk(chunk, source, target))));
  }
  return translated.join(' ');
}

function showPreview(url) {
  const preview = $('#documentPreview');
  const placeholder = $('.camera-placeholder');
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = url;
  preview.src = url;
  preview.hidden = false;
  preview.style.display = 'block';
  placeholder.style.display = 'none';
  $('#cameraVideo').style.display = 'none';
}

async function recognizeImage(image, pageLabel = '') {
  if (!window.Tesseract) throw new Error('Die Texterkennung konnte nicht geladen werden. Bitte prüfe deine Internetverbindung.');
  const selected = sourceLanguage.options[sourceLanguage.selectedIndex];
  const ocrLanguage = selected.dataset.ocr || 'deu';
  const result = await window.Tesseract.recognize(image, ocrLanguage, {
    logger(message) {
      if (message.status === 'recognizing text') {
        setScanStatus('Text wird erkannt …', `${pageLabel}${languageNames[sourceLanguage.value]} · ${Math.round((message.progress || 0) * 100)} %`, (message.progress || 0) * 100);
      }
    }
  });
  return result?.data?.text || '';
}

async function renderPdfPage(page, scale = 2.35) {
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d', { alpha: false });
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: context, viewport, background: '#ffffff' }).promise;
  return canvas;
}

async function extractPdfText(file) {
  setScanStatus('PDF wird geöffnet …', file.name, 5);
  const pdfjs = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.min.mjs');
  pdfjs.GlobalWorkerOptions.workerSrc = 'https://cdn.jsdelivr.net/npm/pdfjs-dist@5.4.149/build/pdf.worker.min.mjs';
  const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
  const pageLimit = Math.min(document.numPages, 10);
  const pageTexts = [];

  for (let pageNumber = 1; pageNumber <= pageLimit; pageNumber += 1) {
    setScanStatus('PDF wird gelesen …', `Seite ${pageNumber} von ${pageLimit}`, (pageNumber / pageLimit) * 65);
    const page = await document.getPage(pageNumber);
    const content = await page.getTextContent();
    let pageText = content.items.map(item => item.str).join(' ').trim();
    const useVisualOcr = RTL_DOCUMENT_LANGUAGES.has(sourceLanguage.value);

    if (useVisualOcr || pageText.length < 25) {
      const canvas = await renderPdfPage(page);
      if (pageNumber === 1) showPreview(canvas.toDataURL('image/jpeg', 0.9));
      try {
        const recognizedText = await recognizeImage(canvas, `Seite ${pageNumber}: `);
        if (recognizedText.trim()) pageText = recognizedText;
      } catch (error) {
        if (pageText.length < 25) throw error;
        showToast('Die Bild-Texterkennung war nicht erreichbar. Der eingebettete PDF-Text wird verwendet.');
      }
    }
    if (pageText) pageTexts.push(pageText);
  }

  if (document.numPages > pageLimit) showToast('Aus Sicherheitsgründen wurden die ersten 10 Seiten verarbeitet.');
  return pageTexts.join('\n\n');
}

async function translateCurrentText() {
  const text = sourceText.value.trim();
  clearTranslatorMessages();
  if (!text) {
    showTranslatorError('Bitte nimm zuerst ein Dokument auf, wähle eine Datei oder füge Text ein.');
    sourceText.focus();
    return;
  }

  if (IS_GITHUB_PAGES && sourceLanguage.value !== targetLanguage.value && !$('#translationConsent')?.checked) {
    showTranslatorError('Bitte stimme der Übertragung des Textes an MyMemory zu. Danach erneut „Text übersetzen“ drücken.');
    $('#translationConsent')?.focus();
    return;
  }
  setTranslatorBusy(true);
  setScanStatus('Text wird übersetzt …', `${languageNames[sourceLanguage.value]} → ${languageNames[targetLanguage.value]}`, 75);
  try {
    const translatedText = await translateTextInBrowser(text, sourceLanguage.value, targetLanguage.value);
    $('#translatedText').textContent = translatedText;
    $('#resultLanguage').textContent = languageNames[targetLanguage.value].toUpperCase();
    $('#scanStatus').classList.add('hidden');
    $('#scanResult').classList.remove('hidden');
    $('#scanResult').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    showTranslatorError(error.message || 'Die Übersetzung ist fehlgeschlagen. Bitte versuche es erneut.');
  } finally {
    setTranslatorBusy(false);
  }
}

async function processDocument(file) {
  clearTranslatorMessages();
  if (file.size > 12 * 1024 * 1024) {
    showTranslatorError('Die Datei ist zu groß. Bitte wähle eine Datei mit höchstens 12 MB.');
    return;
  }
  setTranslatorBusy(true);
  try {
    let text = '';
    if (file.type === 'text/plain' || file.name.toLowerCase().endsWith('.txt')) {
      setScanStatus('Textdatei wird gelesen …', file.name, 30);
      text = await file.text();
    } else if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
      text = await extractPdfText(file);
    } else if (file.type.startsWith('image/')) {
      showPreview(URL.createObjectURL(file));
      setScanStatus('Bild wird vorbereitet …', file.name, 5);
      text = await recognizeImage(file);
    } else {
      throw new Error('Bitte wähle ein Bild, eine PDF- oder eine Textdatei aus.');
    }

    if (!text.trim()) throw new Error('Auf dem Dokument konnte kein lesbarer Text erkannt werden. Bitte nutze ein schärferes, gut beleuchtetes Bild.');
    setSourceText(text);
    setTranslatorBusy(false);
    await translateCurrentText();
  } catch (error) {
    showTranslatorError(error.message || 'Das Dokument konnte nicht gelesen werden.');
    setTranslatorBusy(false);
  }
}

async function loadArabicSample() {
  clearTranslatorMessages();
  sourceLanguage.value = 'ar';
  targetLanguage.value = 'de';
  sourceText.dir = 'rtl';
  setScanStatus('Test-PDF wird geladen …', 'Arabisch → Deutsch', 2);
  try {
    const response = await fetch('/arabisches-testdokument.pdf');
    if (!response.ok) throw new Error('Die Test-PDF konnte nicht geladen werden.');
    const blob = await response.blob();
    await processDocument(new File([blob], 'arabisches-testdokument.pdf', { type: 'application/pdf' }));
  } catch (error) {
    showTranslatorError(error.message || 'Die Test-PDF konnte nicht verarbeitet werden.');
    setTranslatorBusy(false);
  }
}

async function openCamera() {
  if (!navigator.mediaDevices?.getUserMedia) {
    showTranslatorError('Dein Browser unterstützt keine Kameraaufnahme. Bitte wähle stattdessen ein Bild aus.');
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
    const video = $('#cameraVideo');
    video.srcObject = cameraStream;
    video.style.display = 'block';
    $('#documentPreview').style.display = 'none';
    $('.camera-placeholder').style.display = 'none';
    cameraButton.textContent = 'Foto aufnehmen';
    clearTranslatorMessages();
  } catch {
    showTranslatorError('Die Kamera konnte nicht geöffnet werden. Erlaube den Kamerazugriff oder wähle ein Bild aus.');
  }
}

async function capturePhoto() {
  const video = $('#cameraVideo');
  if (!video.videoWidth) {
    showTranslatorError('Die Kamera ist noch nicht bereit. Bitte versuche es gleich noch einmal.');
    return;
  }
  const canvas = $('#captureCanvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  cameraStream.getTracks().forEach(track => track.stop());
  cameraStream = null;
  video.srcObject = null;
  cameraButton.textContent = 'Kamera öffnen';
  canvas.toBlob(async (blob) => {
    if (!blob) return showTranslatorError('Das Foto konnte nicht aufgenommen werden.');
    showPreview(URL.createObjectURL(blob));
    await processDocument(new File([blob], 'kamera-aufnahme.jpg', { type: 'image/jpeg' }));
  }, 'image/jpeg', 0.92);
}

cameraButton.addEventListener('click', () => cameraStream ? capturePhoto() : openCamera());
$('#documentInput').addEventListener('change', event => {
  const file = event.target.files?.[0];
  if (!file) return;
  showToast(`${file.name} wurde ausgewählt.`);
  processDocument(file);
  event.target.value = '';
});
$('#loadArabicSample').addEventListener('click', loadArabicSample);
sourceText.addEventListener('input', updateCharacterCount);
sourceLanguage.addEventListener('change', () => {
  sourceText.dir = RTL_DOCUMENT_LANGUAGES.has(sourceLanguage.value) ? 'rtl' : 'auto';
});
translateButton.addEventListener('click', translateCurrentText);
$('#swapLanguages').addEventListener('click', () => {
  const source = sourceLanguage.value;
  sourceLanguage.value = targetLanguage.value;
  targetLanguage.value = source;
  if (!sourceLanguage.value) sourceLanguage.value = 'de';
});
$('#copyTranslation').addEventListener('click', async () => {
  const text = $('#translatedText').textContent;
  try {
    await navigator.clipboard.writeText(text);
    showToast('Übersetzung wurde kopiert.');
  } catch {
    showToast('Kopieren nicht möglich. Bitte markiere den Text manuell.');
  }
});
$('#downloadTranslation').addEventListener('click', () => {
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([$('#translatedText').textContent], { type: 'text/plain;charset=utf-8' }));
  link.download = `uebersetzung-${targetLanguage.value}.txt`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

$('#readTranslation').addEventListener('click', () => {
  const text = $('#translatedText').textContent.trim();
  if (!text || !('speechSynthesis' in window)) {
    showToast('Vorlesen wird von diesem Browser nicht unterstützt.');
    return;
  }
  if (pageReader.state !== 'idle') {
    stopPageReading(false);
  } else if (speechSynthesis.speaking) {
    speechSynthesis.cancel();
    $('#readTranslation').textContent = 'Vorlesen';
    return;
  }
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = { de: 'de-DE', en: 'en-GB', ar: 'ar-SA', tr: 'tr-TR', uk: 'uk-UA', fr: 'fr-FR', es: 'es-ES', it: 'it-IT', pl: 'pl-PL', ru: 'ru-RU', fa: 'fa-IR' }[targetLanguage.value] || targetLanguage.value;
  utterance.onend = () => { $('#readTranslation').textContent = 'Vorlesen'; };
  utterance.onerror = () => { $('#readTranslation').textContent = 'Vorlesen'; showToast('Der Text konnte nicht vorgelesen werden.'); };
  $('#readTranslation').textContent = 'Vorlesen stoppen';
  speechSynthesis.speak(utterance);
});

const helpFinderForm = $('#helpFinderForm');
helpFinderForm.addEventListener('submit', event => {
  event.preventDefault();
  const topic = $('#helpTopic').value;
  const urgency = $('#helpUrgency').value;
  const result = $('#helpFinderResult');
  result.hidden = false;
  result.classList.toggle('urgent', urgency === 'acute');

  if (urgency === 'acute') {
    result.innerHTML = '<strong>Bitte nutze jetzt die Soforthilfe.</strong><span>Bei unmittelbarer Gefahr solltest du nicht auf einen Beratungstermin warten.</span><button class="btn btn-primary full" type="button" id="openEmergencyResult">Soforthilfe öffnen</button>';
    $('#openEmergencyResult').addEventListener('click', () => { location.hash = '#/soforthilfe'; });
  } else {
    const urgencyText = urgency === 'soon' ? 'Weil eine Frist oder ein dringendes Problem besteht, wähle möglichst den frühesten Termin.' : 'Eine persönliche Erstberatung kann dein Anliegen ordnen und die nächsten Schritte klären.';
    result.innerHTML = `<strong>Empfehlung: ${topic}</strong><span>${urgencyText}</span><button class="btn btn-primary full" type="button" id="bookFinderResult">Termin buchen</button>`;
    const openRecommendedBooking = () => {
      if (!$('#bookingSuccess').hidden) resetBookingForm();
      $('#bookingTopic').value = topic;
      syncBookingLanguageToSite();
      openModal(bookingModal);
    };
    $('#bookFinderResult').addEventListener('click', openRecommendedBooking);
  }
  translateDynamicSection(result);
});

let currentDeadline = null;
const deadlineDate = $('#deadlineDate');
function localDateValue(date = new Date()) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
deadlineDate.min = localDateValue();
$('#deadlineForm').addEventListener('submit', event => {
  event.preventDefault();
  const title = $('#deadlineTitle').value.trim();
  const date = deadlineDate.value;
  const result = $('#deadlineResult');
  if (!title || !date) return;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const target = new Date(`${date}T00:00:00`);
  const remaining = Math.ceil((target - today) / 86400000);
  currentDeadline = { title, date, uid: crypto.randomUUID() };
  result.hidden = false;
  result.classList.toggle('urgent', remaining <= 3);
  result.innerHTML = remaining < 0
    ? '<strong>Diese Frist ist bereits abgelaufen.</strong><span>Hole möglichst schnell persönliche Beratung ein.</span>'
    : `<strong>${remaining === 0 ? 'Die Frist ist heute.' : `Noch ${remaining} Tag${remaining === 1 ? '' : 'e'}.`}</strong><span>Plane Zeit für Rückfragen und fehlende Unterlagen ein.</span>`;
  $('#downloadDeadline').hidden = false;
  $('#deadlineImportHelp').hidden = false;
  translateDynamicSection(result);
});

$('#downloadDeadline').addEventListener('click', () => {
  if (!currentDeadline) return;
  const compactDate = currentDeadline.date.replaceAll('-', '');
  const endDate = new Date(`${currentDeadline.date}T12:00:00`);
  endDate.setDate(endDate.getDate() + 1);
  const compactEndDate = localDateValue(endDate).replaceAll('-', '');
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const escapeIcs = value => value.replaceAll('\\', '\\\\').replaceAll(',', '\\,').replaceAll(';', '\\;').replaceAll('\n', '\\n');
  const ics = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Caritas Wegweiser//DE', 'BEGIN:VEVENT', `UID:${currentDeadline.uid}@caritas-wegweiser.de`, `DTSTAMP:${timestamp}`, `DTSTART;VALUE=DATE:${compactDate}`, `DTEND;VALUE=DATE:${compactEndDate}`, `SUMMARY:${escapeIcs(currentDeadline.title)}`, 'DESCRIPTION:Frist-Erinnerung aus dem Caritas Wegweiser', 'BEGIN:VALARM', 'TRIGGER:-P1D', 'ACTION:DISPLAY', `DESCRIPTION:${escapeIcs(currentDeadline.title)}`, 'END:VALARM', 'END:VEVENT', 'END:VCALENDAR'].join('\r\n');
  const link = document.createElement('a');
  link.href = URL.createObjectURL(new Blob([ics], { type: 'text/calendar;charset=utf-8' }));
  link.download = 'frist-erinnerung.ics';
  document.body.appendChild(link);
  link.click();
  link.remove();
  showToast('Kalenderdatei öffnen und den Import in deiner Kalender-App bestätigen.');
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
});

const checklistItems = {
  general: ['Ausweis oder Pass', 'Alle wichtigen Briefe und Bescheide', 'Notizen mit deinen wichtigsten Fragen', 'Vorhandene Anträge und Antworten'],
  finance: ['Ausweis oder Pass', 'Aktuelle Bescheide', 'Einkommensnachweise', 'Mietvertrag und Kontoauszüge', 'Mahnungen oder Forderungen'],
  housing: ['Ausweis oder Pass', 'Mietvertrag', 'Schriftverkehr mit Vermieter oder Behörde', 'Nebenkostenabrechnung', 'Fotos oder Nachweise zum Problem'],
  family: ['Ausweise der Beteiligten', 'Geburtsurkunden, falls relevant', 'Bescheide zu Kindergeld oder Leistungen', 'Schriftverkehr mit Behörden oder Schule'],
  migration: ['Pass oder Aufenthaltsdokumente', 'Briefe der Ausländerbehörde oder des BAMF', 'Meldebescheinigung', 'Arbeits- oder Mietvertrag, falls relevant'],
  care: ['Versichertenkarte', 'Arztberichte oder Medikamentenplan', 'Bescheide der Pflegekasse', 'Vollmacht, falls vorhanden']
};

function renderChecklist() {
  const topic = $('#checklistTopic').value;
  let saved = [];
  try {
    const stored = JSON.parse(localStorage.getItem(`caritas-checklist-${topic}`) || '[]');
    if (Array.isArray(stored)) saved = stored.filter(Number.isInteger);
  } catch { /* Ignore damaged local data and start with a clean checklist. */ }
  $('#personalChecklist').innerHTML = checklistItems[topic].map((item, index) => `<label class="check-item"><input type="checkbox" data-check-index="${index}" ${saved.includes(index) ? 'checked' : ''}><span>${item}</span></label>`).join('');
  $$('[data-check-index]', $('#personalChecklist')).forEach(input => input.addEventListener('change', () => {
    const completed = $$('[data-check-index]:checked', $('#personalChecklist')).map(item => Number(item.dataset.checkIndex));
    localStorage.setItem(`caritas-checklist-${topic}`, JSON.stringify(completed));
  }));
  translateDynamicSection($('#personalChecklist'));
}

$('#checklistTopic').addEventListener('change', renderChecklist);
$('#resetChecklist').addEventListener('click', () => {
  localStorage.removeItem(`caritas-checklist-${$('#checklistTopic').value}`);
  renderChecklist();
  showToast('Die Checkliste wurde zurückgesetzt.');
});
$('#printChecklist').addEventListener('click', () => window.print());
renderChecklist();

const accessibilityButton = $('#accessibilityButton');
const accessibilityPanel = $('#accessibilityPanel');
const accessibilityOptions = {
  largeText: { button: $('#largeTextToggle'), className: 'large-text', label: 'Große Schrift' },
  highContrast: { button: $('#highContrastToggle'), className: 'high-contrast', label: 'Hoher Kontrast' },
  reduceMotion: { button: $('#reduceMotionToggle'), className: 'reduce-motion', label: 'Weniger Bewegung' },
  simpleView: { button: $('#simpleViewToggle'), className: 'simple-view', label: 'Einfache Ansicht' }
};
const ACCESSIBILITY_STORAGE_KEY = 'caritasAccessibilitySettings';
let accessibilitySettings = {};

const pageReader = {
  chunks: [],
  index: 0,
  state: 'idle',
  session: 0
};
const speechLanguages = { de: 'de-DE', en: 'en-GB', ar: 'ar-SA', tr: 'tr-TR', uk: 'uk-UA' };
const pageReaderCopy = {
  de: { read: 'Seite vorlesen', restart: 'Neu starten', pause: 'Pause', resume: 'Fortsetzen', ready: 'Bereit zum Vorlesen.', speaking: 'Die aktuelle Seite wird vorgelesen.', paused: 'Vorlesen pausiert.', resumed: 'Vorlesen wird fortgesetzt.', stopped: 'Vorlesen gestoppt.', ended: 'Vorlesen beendet.', unsupported: 'Vorlesen wird von diesem Browser nicht unterstützt.', empty: 'Auf dieser Seite wurde kein lesbarer Text gefunden.', error: 'Der Text konnte nicht vorgelesen werden.' },
  en: { read: 'Read page aloud', restart: 'Restart', pause: 'Pause', resume: 'Continue', ready: 'Ready to read aloud.', speaking: 'The current page is being read aloud.', paused: 'Reading paused.', resumed: 'Reading continues.', stopped: 'Reading stopped.', ended: 'Reading finished.', unsupported: 'Your browser does not support reading aloud.', empty: 'No readable text was found on this page.', error: 'The text could not be read aloud.' },
  ar: { read: 'قراءة الصفحة', restart: 'إعادة التشغيل', pause: 'إيقاف مؤقت', resume: 'متابعة', ready: 'جاهز للقراءة.', speaking: 'تتم قراءة الصفحة الحالية.', paused: 'تم إيقاف القراءة مؤقتًا.', resumed: 'تمت متابعة القراءة.', stopped: 'تم إيقاف القراءة.', ended: 'انتهت القراءة.', unsupported: 'هذا المتصفح لا يدعم القراءة بصوت عالٍ.', empty: 'لم يتم العثور على نص قابل للقراءة في هذه الصفحة.', error: 'تعذرت قراءة النص بصوت عالٍ.' },
  tr: { read: 'Sayfayı sesli oku', restart: 'Yeniden başlat', pause: 'Duraklat', resume: 'Devam et', ready: 'Sesli okumaya hazır.', speaking: 'Geçerli sayfa sesli okunuyor.', paused: 'Okuma duraklatıldı.', resumed: 'Okumaya devam ediliyor.', stopped: 'Okuma durduruldu.', ended: 'Okuma tamamlandı.', unsupported: 'Bu tarayıcı sesli okumayı desteklemiyor.', empty: 'Bu sayfada okunabilir metin bulunamadı.', error: 'Metin sesli okunamadı.' },
  uk: { read: 'Прочитати сторінку', restart: 'Почати знову', pause: 'Пауза', resume: 'Продовжити', ready: 'Готово до читання.', speaking: 'Поточна сторінка читається вголос.', paused: 'Читання призупинено.', resumed: 'Читання продовжено.', stopped: 'Читання зупинено.', ended: 'Читання завершено.', unsupported: 'Цей браузер не підтримує читання вголос.', empty: 'На цій сторінці не знайдено тексту для читання.', error: 'Не вдалося прочитати текст уголос.' }
};

function pageTextForReading() {
  return $$('.route-page.route-active').map(activePage => {
    const copy = activePage.cloneNode(true);
    $$('script, style, svg, form, button, input, select, textarea, [hidden], .hidden, [aria-hidden="true"]', copy).forEach(element => element.remove());
    return copy.textContent.replace(/\s+/g, ' ').trim();
  }).filter(Boolean).join(' ');
}

function splitSpeechText(text, maxLength = 220) {
  const sentences = text.match(/[^.!?。！？]+[.!?。！？]+|[^.!?。！？]+$/g) || [text];
  const chunks = [];
  sentences.forEach(sentence => {
    const clean = sentence.trim();
    if (!clean) return;
    if (clean.length <= maxLength) {
      chunks.push(clean);
      return;
    }
    const words = clean.split(/\s+/);
    let chunk = '';
    words.forEach(word => {
      if (chunk && `${chunk} ${word}`.length > maxLength) {
        chunks.push(chunk);
        chunk = word;
      } else {
        chunk = chunk ? `${chunk} ${word}` : word;
      }
    });
    if (chunk) chunks.push(chunk);
  });
  return chunks;
}

function updatePageReaderControls(statusKey) {
  const isIdle = pageReader.state === 'idle';
  const isPaused = pageReader.state === 'paused';
  const copy = pageReaderCopy[currentSiteLanguage] || pageReaderCopy.de;
  $('#readPageButton').textContent = isIdle ? copy.read : copy.restart;
  $('#pausePageReading').textContent = isPaused ? copy.resume : copy.pause;
  $('#pausePageReading').disabled = isIdle;
  $('#stopPageReading').disabled = isIdle;
  if (statusKey) $('#speechReaderStatus').textContent = copy[statusKey];
}

function preferredSpeechVoice(language) {
  const voices = speechSynthesis.getVoices();
  const exact = voices.find(voice => voice.lang.toLowerCase() === language.toLowerCase());
  return exact || voices.find(voice => voice.lang.toLowerCase().startsWith(language.slice(0, 2).toLowerCase())) || null;
}

function speakNextPageChunk(session) {
  if (session !== pageReader.session || pageReader.state === 'idle') return;
  if (pageReader.index >= pageReader.chunks.length) {
    pageReader.state = 'idle';
    updatePageReaderControls('ended');
    return;
  }
  const language = speechLanguages[currentSiteLanguage] || document.documentElement.lang || 'de-DE';
  const utterance = new SpeechSynthesisUtterance(pageReader.chunks[pageReader.index]);
  utterance.lang = language;
  const voice = preferredSpeechVoice(language);
  if (voice) utterance.voice = voice;
  utterance.onend = () => {
    if (session !== pageReader.session) return;
    pageReader.index += 1;
    speakNextPageChunk(session);
  };
  utterance.onerror = event => {
    if (session !== pageReader.session || event.error === 'canceled' || event.error === 'interrupted') return;
    pageReader.state = 'idle';
    updatePageReaderControls('error');
  };
  speechSynthesis.speak(utterance);
}

function stopPageReading(announce = true) {
  pageReader.session += 1;
  pageReader.state = 'idle';
  pageReader.chunks = [];
  pageReader.index = 0;
  if ('speechSynthesis' in window) speechSynthesis.cancel();
  updatePageReaderControls(announce ? 'stopped' : 'ready');
}

function startPageReading() {
  if (!('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
    updatePageReaderControls('unsupported');
    return;
  }
  const text = pageTextForReading();
  if (!text) {
    updatePageReaderControls('empty');
    return;
  }
  speechSynthesis.cancel();
  $('#readTranslation').textContent = 'Vorlesen';
  pageReader.session += 1;
  pageReader.chunks = splitSpeechText(text);
  pageReader.index = 0;
  pageReader.state = 'speaking';
  updatePageReaderControls('speaking');
  speakNextPageChunk(pageReader.session);
}

$('#readPageButton').addEventListener('click', startPageReading);
$('#pausePageReading').addEventListener('click', () => {
  if (pageReader.state === 'speaking') {
    speechSynthesis.pause();
    pageReader.state = 'paused';
    updatePageReaderControls('paused');
  } else if (pageReader.state === 'paused') {
    speechSynthesis.resume();
    pageReader.state = 'speaking';
    updatePageReaderControls('resumed');
  }
});
$('#stopPageReading').addEventListener('click', () => stopPageReading());
updatePageReaderControls('ready');

try {
  accessibilitySettings = JSON.parse(localStorage.getItem(ACCESSIBILITY_STORAGE_KEY) || '{}');
} catch { accessibilitySettings = {}; }

function applyAccessibilitySettings(announce = false) {
  Object.entries(accessibilityOptions).forEach(([key, option]) => {
    const enabled = accessibilitySettings[key] === true;
    document.body.classList.toggle(option.className, enabled);
    option.button.setAttribute('aria-pressed', String(enabled));
  });
  try { localStorage.setItem(ACCESSIBILITY_STORAGE_KEY, JSON.stringify(accessibilitySettings)); } catch { /* Settings still apply for this visit. */ }
  if (announce) $('#accessibilityStatus').textContent = 'Die Anzeige-Einstellungen wurden übernommen.';
}

function closeAccessibilityPanel({ restoreFocus = true } = {}) {
  accessibilityPanel.hidden = true;
  accessibilityButton.setAttribute('aria-expanded', 'false');
  if (restoreFocus) accessibilityButton.focus();
}

accessibilityButton.addEventListener('click', () => {
  const willOpen = accessibilityPanel.hidden;
  accessibilityPanel.hidden = !willOpen;
  accessibilityButton.setAttribute('aria-expanded', String(willOpen));
  if (willOpen) setTimeout(() => $('#closeAccessibility').focus(), 20);
});
$('#closeAccessibility').addEventListener('click', () => closeAccessibilityPanel());
Object.entries(accessibilityOptions).forEach(([key, option]) => option.button.addEventListener('click', () => {
  accessibilitySettings[key] = !accessibilitySettings[key];
  applyAccessibilitySettings(true);
}));
$('#resetAccessibility').addEventListener('click', () => {
  accessibilitySettings = {};
  applyAccessibilitySettings(true);
});
applyAccessibilitySettings();

const SITE_TRANSLATION_CACHE_VERSION = 'v4';
const siteTextEntries = [];
const siteAttributeEntries = [];
const siteTranslationCaches = {};
const pageTranslationNames = { de: 'Deutsch', en: 'English', ar: 'العربية', tr: 'Türkçe', uk: 'Українська' };

function shouldTranslateSiteText(value, parent) {
  const text = value.trim();
  if (!text || !/[A-Za-zÄÖÜäöüßА-Яа-яІіЇїЄєĞğŞşİıÇç]/.test(text)) return false;
  if (parent?.closest('#languageSelect, #sourceLanguage, #targetLanguage, #sourceText, #translatedText, .slot small, .message.user, .notranslate, script, style, svg')) return false;
  if (/^(caritas|wegweiser|DE|EN|AR|TR|UK|AM)$/i.test(text) || /@|https?:|^\+?[\d\s–-]+$/.test(text)) return false;
  return true;
}

function captureSiteContent(root = document.body) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (!shouldTranslateSiteText(node.nodeValue, node.parentElement)) continue;
    if (!siteTextEntries.some(entry => entry.node === node)) {
      siteTextEntries.push({ node, original: node.nodeValue, text: node.nodeValue.trim() });
    }
  }
  $$('[placeholder], [aria-label], [title]', root).forEach(element => {
    if (element.closest('#languageSelect, #sourceLanguage, #targetLanguage')) return;
    ['placeholder', 'aria-label', 'title'].forEach(attribute => {
      const value = element.getAttribute(attribute);
      if (value && shouldTranslateSiteText(value, null) && !siteAttributeEntries.some(entry => entry.element === element && entry.attribute === attribute)) {
        siteAttributeEntries.push({ element, attribute, original: value, text: value.trim() });
      }
    });
  });
}

function readSiteTranslationCache(language) {
  if (siteTranslationCaches[language]) return siteTranslationCaches[language];
  try {
    siteTranslationCaches[language] = JSON.parse(localStorage.getItem(`caritas-site-${SITE_TRANSLATION_CACHE_VERSION}-${language}`) || '{}');
  } catch {
    siteTranslationCaches[language] = {};
  }
  return siteTranslationCaches[language];
}

function saveSiteTranslationCache(language) {
  try {
    localStorage.setItem(`caritas-site-${SITE_TRANSLATION_CACHE_VERSION}-${language}`, JSON.stringify(siteTranslationCaches[language] || {}));
  } catch { /* Translation still works without persistent cache. */ }
}

function groupInterfaceStrings(strings) {
  const groups = [];
  let group = [];
  let bytes = 0;
  strings.forEach(text => {
    const textBytes = textEncoder.encode(text).length + (group.length ? 32 : 0);
    if (group.length && bytes + textBytes > 420) {
      groups.push(group);
      group = [];
      bytes = 0;
    }
    group.push(text);
    bytes += textBytes;
  });
  if (group.length) groups.push(group);
  return groups;
}

async function translateInterfaceGroup(group, language) {
  if (group.length === 1) return [await translateChunk(group[0], 'de', language)];
  const combined = group.map((text, index) => index ? `<<<CARITAS_BREAK_${index}>>>\n${text}` : text).join('\n');
  const translated = await translateChunk(combined, 'de', language);
  const parts = translated.split(/\s*<<<CARITAS_BREAK_\d+>>>\s*/);
  if (parts.length === group.length) return parts;
  return Promise.all(group.map(text => translateChunk(text, 'de', language)));
}

async function translateSiteStrings(strings, language) {
  const unique = [...new Set(strings.filter(Boolean))];
  const cache = readSiteTranslationCache(language);
  const missing = unique.filter(text => !cache[text]);
  if (!missing.length) return cache;

  const groups = groupInterfaceStrings(missing);
  for (let index = 0; index < groups.length; index += 3) {
    const currentGroups = groups.slice(index, index + 3);
    const results = await Promise.allSettled(currentGroups.map(group => translateInterfaceGroup(group, language)));
    currentGroups.forEach((group, groupIndex) => {
      const result = results[groupIndex];
      if (result.status !== 'fulfilled') return;
      group.forEach((text, textIndex) => { cache[text] = result.value[textIndex]; });
    });
  }
  saveSiteTranslationCache(language);
  return cache;
}

function replacePreservingWhitespace(original, translated) {
  const leading = original.match(/^\s*/)?.[0] || '';
  const trailing = original.match(/\s*$/)?.[0] || '';
  return `${leading}${translated}${trailing}`;
}

function restoreGermanSite() {
  siteTextEntries.forEach(entry => { if (entry.node.isConnected) entry.node.nodeValue = entry.original; });
  siteAttributeEntries.forEach(entry => { if (entry.element.isConnected) entry.element.setAttribute(entry.attribute, entry.original); });
}

function isTranslationEntryActive(element) {
  if (!element?.isConnected) return false;
  const route = element.closest('.route-page');
  if (route && !route.classList.contains('route-active')) return false;
  const modal = element.closest('.modal');
  if (modal && !modal.classList.contains('open')) return false;
  const panel = element.closest('.ai-panel');
  if (panel && !panel.classList.contains('open')) return false;
  if (element.closest('[hidden], .hidden')) return false;
  return true;
}

async function translateVisibleSite(language, notify = true) {
  const textEntries = siteTextEntries.filter(entry => isTranslationEntryActive(entry.node.parentElement));
  const attributeEntries = siteAttributeEntries.filter(entry => isTranslationEntryActive(entry.element));
  const requested = [...textEntries.map(entry => entry.text), ...attributeEntries.map(entry => entry.text)];
  const cache = await translateSiteStrings(requested, language);
  let translatedCount = 0;
  textEntries.forEach(entry => {
    if (cache[entry.text]) {
      entry.node.nodeValue = replacePreservingWhitespace(entry.original, cache[entry.text]);
      translatedCount += 1;
    }
  });
  attributeEntries.forEach(entry => {
    if (cache[entry.text]) {
      entry.element.setAttribute(entry.attribute, cache[entry.text]);
      translatedCount += 1;
    }
  });
  if (!translatedCount && requested.length) throw new Error('No translations returned');
  if (notify) {
    const complete = translatedCount === requested.length;
    showToast(complete ? `${pageTranslationNames[language]}: Diese Seite wurde übersetzt.` : `${pageTranslationNames[language]}: Ein Teil der Seite wurde übersetzt. Weitere Inhalte werden beim Öffnen geladen.`);
  }
}

async function translateDynamicSection(root) {
  // Google Website Translator processes the complete document, including dialogs.
  // Keeping this function as a no-op preserves all existing UI call sites.
  return;
  if (!root || currentSiteLanguage === 'de') return;
  const dynamicEntries = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    if (shouldTranslateSiteText(node.nodeValue, node.parentElement)) {
      const entry = { node, original: node.nodeValue, text: node.nodeValue.trim() };
      dynamicEntries.push(entry);
      if (!siteTextEntries.some(item => item.node === node)) siteTextEntries.push(entry);
    }
  }
  if (!dynamicEntries.length) return;
  try {
    const cache = await translateSiteStrings(dynamicEntries.map(entry => entry.text), currentSiteLanguage);
    if (currentSiteLanguage !== 'de') dynamicEntries.forEach(entry => {
      if (entry.node.isConnected && cache[entry.text]) entry.node.nodeValue = replacePreservingWhitespace(entry.original, cache[entry.text]);
    });
  } catch { /* Keep the German fallback for this dynamic status. */ }
}

function setGoogleTranslationCookie(language) {
  const cookieValue = language === 'de' ? '/de/de' : `/de/${language}`;
  document.cookie = `googtrans=${cookieValue};path=/;SameSite=Lax`;
  document.cookie = `googtrans=${cookieValue};path=/;domain=${location.hostname};SameSite=Lax`;
  return cookieValue;
}

function currentGoogleTranslationCookie() {
  return document.cookie.split('; ').find(value => value.startsWith('googtrans='))?.slice('googtrans='.length) || '';
}

async function applySiteLanguage(language) {
  currentSiteLanguage = language;
  localStorage.setItem('caritasSiteLanguage', language);
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  targetLanguage.value = language;
  setGoogleTranslationCookie(language);
  sessionStorage.setItem('caritasTranslationBootstrapped', language);
  document.body.classList.add('site-translating');
  location.reload();
}

$('#languageSelect').addEventListener('change', event => applySiteLanguage(event.target.value));
const savedSiteLanguage = localStorage.getItem('caritasSiteLanguage');
if (savedSiteLanguage && pageTranslationNames[savedSiteLanguage]) {
  currentSiteLanguage = savedSiteLanguage;
  $('#languageSelect').value = savedSiteLanguage;
  document.documentElement.lang = savedSiteLanguage;
  document.documentElement.dir = savedSiteLanguage === 'ar' ? 'rtl' : 'ltr';
  targetLanguage.value = savedSiteLanguage;
  if (savedSiteLanguage !== 'de') {
    document.body.classList.add('site-translating');
    const desiredCookie = `/de/${savedSiteLanguage}`;
    if (currentGoogleTranslationCookie() !== desiredCookie && sessionStorage.getItem('caritasTranslationBootstrapped') !== savedSiteLanguage) {
      setGoogleTranslationCookie(savedSiteLanguage);
      sessionStorage.setItem('caritasTranslationBootstrapped', savedSiteLanguage);
      location.reload();
    }
  }
}
updatePageReaderControls('ready');

window.addEventListener('google-translate-ready', () => {
  document.body.classList.remove('site-translating');
  if (currentSiteLanguage !== 'de') showToast(`${pageTranslationNames[currentSiteLanguage]}: Die Website wurde vollständig übersetzt.`);
});
if (window.googleTranslateReady) document.body.classList.remove('site-translating');

setTimeout(() => {
  if (currentSiteLanguage !== 'de' && !$('.goog-te-combo')) {
    document.body.classList.remove('site-translating');
    showToast('Der Übersetzungsdienst konnte nicht geladen werden. Bitte prüfe deine Internetverbindung und versuche es erneut.');
  }
}, 8000);

document.addEventListener('keydown', event => {
  const openModalElement = $('.modal.open');
  const activeDialog = openModalElement || (aiPanel.classList.contains('open') ? aiPanel : null);
  if (event.key === 'Tab' && activeDialog) {
    const focusable = focusableElements(activeDialog);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }
  if (event.key === 'Escape') {
    if (openModalElement) closeModals();
    else if (aiPanel.classList.contains('open')) closeAi();
    else if (!accessibilityPanel.hidden) closeAccessibilityPanel();
    else if (mobileMenu.classList.contains('open')) {
      mobileMenu.classList.remove('open');
      mobileMenu.setAttribute('aria-hidden', 'true');
      mobileMenu.setAttribute('inert', '');
      menuButton.setAttribute('aria-expanded', 'false');
      menuButton.focus();
    }
  }
});

const observer = new IntersectionObserver(entries => {
  entries.forEach(entry => { if (entry.isIntersecting) entry.target.classList.add('visible'); });
}, { threshold: .13 });
$$('.reveal').forEach(element => observer.observe(element));

// Let the hero appear immediately even when IntersectionObserver is delayed.
setTimeout(() => $$('.hero .reveal').forEach(element => element.classList.add('visible')), 120);
