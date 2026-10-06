-- ============================================================
-- ARTALUZ — Taxonomie de départ (à relire par un référent par religion)
-- Modifiable ensuite depuis le back office.
-- ============================================================

insert into public.religions (id, name, calendar, figure_label, sort_order) values
  ('islam',          'Islam',          'hijri',     'Prophètes et calligraphies', 1),
  ('judaisme',       'Judaïsme',       'hebrew',    'Figures bibliques',          2),
  ('catholicisme',   'Catholicisme',   'gregorian', 'Saints',                     3),
  ('protestantisme', 'Protestantisme', 'gregorian', 'Figures bibliques et réformateurs', 4),
  ('bouddhisme',     'Bouddhisme',     'lunisolar', 'Bouddhas et bodhisattvas',   5)
on conflict (id) do update set name = excluded.name, calendar = excluded.calendar,
  figure_label = excluded.figure_label, sort_order = excluded.sort_order;

insert into public.occasions (id, religion_id, name, kind, sort_order) values
  -- Islam
  ('ramadan',          'islam', 'Ramadan',            'periode', 1),
  ('aid-al-fitr',      'islam', 'Aïd al-Fitr',        'fete', 2),
  ('aid-al-adha',      'islam', 'Aïd al-Adha',        'fete', 3),
  ('nouvel-an-hegire', 'islam', 'Nouvel an de l''Hégire', 'fete', 4),
  ('mawlid',           'islam', 'Mawlid',             'fete', 5),
  ('naissance-islam',  'islam', 'Naissance (Aqiqa)',  'evenement_de_vie', 10),
  ('mariage-islam',    'islam', 'Mariage',            'evenement_de_vie', 11),
  -- Judaïsme
  ('roch-hachana',     'judaisme', 'Roch Hachana',    'fete', 1),
  ('yom-kippour',      'judaisme', 'Yom Kippour',     'fete', 2),
  ('soukkot',          'judaisme', 'Soukkot',         'fete', 3),
  ('hanoucca',         'judaisme', 'Hanoucca',        'fete', 4),
  ('pourim',           'judaisme', 'Pourim',          'fete', 5),
  ('pessah',           'judaisme', 'Pessa''h',        'fete', 6),
  ('chavouot',         'judaisme', 'Chavouot',        'fete', 7),
  ('bar-bat-mitsva',   'judaisme', 'Bar / Bat-mitsva', 'evenement_de_vie', 10),
  ('mariage-judaisme', 'judaisme', 'Mariage',         'evenement_de_vie', 11),
  -- Catholicisme
  ('avent-noel',       'catholicisme', 'Avent et Noël', 'fete', 1),
  ('epiphanie',        'catholicisme', 'Épiphanie',   'fete', 2),
  ('careme-paques',    'catholicisme', 'Carême et Pâques', 'fete', 3),
  ('pentecote',        'catholicisme', 'Pentecôte',   'fete', 4),
  ('assomption',       'catholicisme', 'Assomption',  'fete', 5),
  ('toussaint',        'catholicisme', 'Toussaint',   'fete', 6),
  ('bapteme-cath',     'catholicisme', 'Baptême',     'evenement_de_vie', 10),
  ('communion',        'catholicisme', 'Communion',   'evenement_de_vie', 11),
  ('mariage-cath',     'catholicisme', 'Mariage',     'evenement_de_vie', 12),
  -- Protestantisme
  ('noel-prot',        'protestantisme', 'Noël',      'fete', 1),
  ('paques-prot',      'protestantisme', 'Vendredi saint et Pâques', 'fete', 2),
  ('pentecote-prot',   'protestantisme', 'Pentecôte', 'fete', 3),
  ('reformation',      'protestantisme', 'Fête de la Réformation', 'fete', 4),
  ('bapteme-prot',     'protestantisme', 'Baptême',   'evenement_de_vie', 10),
  ('confirmation',     'protestantisme', 'Confirmation', 'evenement_de_vie', 11),
  -- Bouddhisme
  ('vesak',            'bouddhisme', 'Vesak',         'fete', 1),
  ('nouvel-an-lunaire','bouddhisme', 'Nouvel an lunaire', 'fete', 2),
  ('losar',            'bouddhisme', 'Losar (nouvel an tibétain)', 'fete', 3),
  ('ulambana',         'bouddhisme', 'Ulambana',      'fete', 4)
on conflict (id) do update set name = excluded.name, kind = excluded.kind, sort_order = excluded.sort_order;

insert into public.figures (id, religion_id, name, feast_month, feast_day) values
  -- Islam (pas de représentation figurative : calligraphies et noms)
  ('ibrahim',          'islam', 'Ibrahim',            null, null),
  ('moussa',           'islam', 'Moussa',             null, null),
  ('issa',             'islam', 'Issa',               null, null),
  ('mohammed',         'islam', 'Mohammed (calligraphie)', null, null),
  ('asma-al-husna',    'islam', 'Les 99 noms (Asma al-Husna)', null, null),
  -- Judaïsme
  ('abraham',          'judaisme', 'Abraham',         null, null),
  ('moise',            'judaisme', 'Moïse',           null, null),
  ('david',            'judaisme', 'David',           null, null),
  ('esther',           'judaisme', 'Esther',          null, null),
  -- Catholicisme (fête fixe dans le calendrier romain)
  ('vierge-marie',     'catholicisme', 'Vierge Marie', 8, 15),
  ('saint-joseph',     'catholicisme', 'Saint Joseph', 3, 19),
  ('saint-pierre-paul','catholicisme', 'Saints Pierre et Paul', 6, 29),
  ('saint-michel',     'catholicisme', 'Saint Michel', 9, 29),
  ('saint-francois',   'catholicisme', 'Saint François d''Assise', 10, 4),
  ('sainte-therese',   'catholicisme', 'Sainte Thérèse de Lisieux', 10, 1),
  ('sainte-jeanne',    'catholicisme', 'Sainte Jeanne d''Arc', 5, 30),
  ('saint-nicolas',    'catholicisme', 'Saint Nicolas', 12, 6),
  ('saint-antoine',    'catholicisme', 'Saint Antoine de Padoue', 6, 13),
  -- Protestantisme
  ('luther',           'protestantisme', 'Martin Luther', null, null),
  ('calvin',           'protestantisme', 'Jean Calvin', null, null),
  ('paul-apotre',      'protestantisme', 'Paul (apôtre)', null, null),
  -- Bouddhisme
  ('bouddha-shakyamuni','bouddhisme', 'Bouddha Shakyamuni', null, null),
  ('avalokiteshvara',  'bouddhisme', 'Avalokiteshvara / Guanyin', null, null),
  ('amitabha',         'bouddhisme', 'Amitabha', null, null),
  ('tara',             'bouddhisme', 'Tara', null, null)
on conflict (id) do update set name = excluded.name, feast_month = excluded.feast_month,
  feast_day = excluded.feast_day;

-- Artiste interne : créations Iota System (aucune royalty générée)
insert into public.artists (email, display_name, tax_status, status, is_internal)
values ('studio@artaluz.com', 'Studio Artaluz', 'interne', 'actif', true)
on conflict (email) do nothing;
