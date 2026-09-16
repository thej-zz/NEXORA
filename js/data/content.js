/* ============================================================
   SITE CONTENT — edit everything here, not in the HTML.
   Every string on the homepage that isn't navigation chrome
   comes from this file. Replace placeholders with the
   association's real copy whenever it's ready.
   ============================================================ */

window.SiteContent = {
  meta: {
    title: 'AI & Data Science Association',
    description: 'A student-driven community exploring artificial intelligence, data science, research and emerging technologies.'
  },

  nav: {
    ctaHome: 'Meet the Team',
    ctaMembers: 'Back Home'
  },

  hero: {
    eyebrow: 'B.TECH \u2022 ARTIFICIAL INTELLIGENCE & DATA SCIENCE',
    headingLines: ['Building', 'intelligence,', 'together.'],
    body: 'A student-driven community exploring artificial intelligence, data science, innovation and emerging technologies \u2014 one project, one workshop, one idea at a time.',
    primaryCta: { label: 'Explore Association', href: '#about' },
    secondaryCta: { label: 'Meet the Team', href: 'members.html' }
  },

  about: {
    index: '01',
    label: 'About the association',
    heading: ['Where intelligence', 'meets imagination.'],
    paragraphs: [
      'The AI & Data Science Association is a student-driven community dedicated to exploring artificial intelligence, data science, emerging technologies and innovation.',
      'Through technical sessions, collaborative projects, workshops and knowledge sharing, we create a space where students can turn ideas into working systems \u2014 and learn from each other while doing it.'
    ]
  },

  pillars: {
    index: '02',
    label: 'What we work on',
    heading: ['Six directions,', 'one community.'],
    items: [
      {
        num: '01',
        title: 'Artificial Intelligence',
        desc: 'Machine learning, intelligent systems and hands-on AI exploration.'
      },
      {
        num: '02',
        title: 'Data Science',
        desc: 'Turning complex, messy data into insight worth acting on.'
      },
      {
        num: '03',
        title: 'Innovation',
        desc: 'Building ideas into real, working solutions students can point to.'
      },
      {
        num: '04',
        title: 'Research',
        desc: 'Following emerging techniques and directions before they\u2019re mainstream.'
      },
      {
        num: '05',
        title: 'Collaboration',
        desc: 'Learning in public, building in pairs, sharing what we find.'
      },
      {
        num: '06',
        title: 'Leadership',
        desc: 'Giving students real opportunities to lead, organize and grow.'
      }
    ]
  },

  activities: {
    index: '03',
    label: 'Initiatives',
    heading: ['Where the work', 'actually happens.'],
    items: [
      { title: 'Workshops', desc: 'Hands-on sessions on tools, frameworks and techniques.' },
      { title: 'Technical Sessions', desc: 'Deep dives led by students and invited speakers.' },
      { title: 'Projects', desc: 'Team-built systems, from first commit to demo day.' },
      { title: 'Hackathons', desc: 'Short, intense sprints on real problems.' },
      { title: 'Research', desc: 'Reading groups and early exploration of new methods.' },
      { title: 'Community Events', desc: 'The social side of a technical community.' }
    ],
    note: 'Placeholder categories \u2014 replace with the association\u2019s actual events and dates.'
  },

  memberPreview: {
    index: '04',
    label: 'Leadership',
    heading: 'Meet the people behind the association.',
    cta: { label: 'View all members', href: 'members.html' }
  },

  membersPage: {
    eyebrow: 'The Team',
    heading: ['Meet the', 'team.'],
    body: 'The students shaping the direction of the AI & Data Science Association.'
  },

  footer: {
    description: 'A student-driven community exploring artificial intelligence, data science, innovation and emerging technologies.',
    copyright: '\u00A9 2026 AI & Data Science Association',
    social: [
      // { label: 'Instagram', href: '#' },
      // { label: 'LinkedIn', href: '#' }
      // No official social links supplied yet \u2014 add them here when available.
    ]
  }
};
