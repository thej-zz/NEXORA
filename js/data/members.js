/* ============================================================
   MEMBER DATA — the only place names, roles and photos live.
   Both index.html (leadership preview) and members.html (full
   hierarchy) render from this file. To update the team, edit
   only this file.

   `image` should point at a photo in /assets/images/members/.
   If a photo isn't available yet, leave it as null \u2014 the
   member card will render a graceful initials placeholder
   instead of a broken image.
   ============================================================ */

window.SiteMembers = {
  president: [
    { name: 'Mahadev - Jefin', role: 'President', blurb: '', image: null }
  ],

  vicePresident: [
    { name: 'Ayush', role: 'Vice President', blurb: '', image: null },
    { name: 'Albin', role: 'Vice President', blurb: '', image: null }
  ],

  secretary: [
    { name: 'Arsha', role: 'Secretary', blurb: '', image: null }
  ],

  jointSecretary: [
    { name: 'Joel', role: 'Joint Secretary', blurb: '', image: null },
    { name: 'Aravind', role: 'Joint Secretary', blurb: '', image: null }
  ],

  treasurer: [
    { name: 'Nehila', role: 'Treasurer', blurb: '', image: null },
    { name: 'Rishil', role: 'Treasurer', blurb: '', image: null }
  ],

  studentCoordinators: [
    { name: 'Deva Priya', role: 'Student Coordinator', blurb: '', image: null },
    { name: 'Abhinay', role: 'Student Coordinator', blurb: '', image: null },
    { name: 'Riya', role: 'Student Coordinator', blurb: '', image: null },
    { name: 'Aravind', role: 'Student Coordinator', blurb: '', image: null }
  ]
};

/* Groups shown on the homepage "leadership preview" strip \u2014
   keep this short; the full hierarchy lives on members.html only. */
window.SiteMembers.preview = [
  window.SiteMembers.president[0],
  window.SiteMembers.vicePresident[0],
  window.SiteMembers.vicePresident[1],
  window.SiteMembers.secretary[0]
];

/* Section order for the members.html hierarchy page. */
window.SiteMembers.sections = [
  { key: 'president', label: 'President', size: 'xl' },
  { key: 'vicePresident', label: 'Vice Presidents', size: 'lg' },
  { key: 'secretary', label: 'Secretary', size: 'lg' },
  { key: 'jointSecretary', label: 'Joint Secretaries', size: 'md' },
  { key: 'treasurer', label: 'Treasurers', size: 'md' },
  { key: 'studentCoordinators', label: 'Student Coordinators', size: 'sm' }
];
