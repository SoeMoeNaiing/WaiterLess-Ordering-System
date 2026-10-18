import { Router } from 'express';

// Both routes hang off /api/admin/menu-items/:itemId/options
// mounted separately from admin.menu-items.js so that file stays focused.

function loadOptionsTree(db, itemId) {
  const groups = db.prepare(
    'SELECT * FROM menu_item_option_groups WHERE menu_item_id = ? ORDER BY sort_order, id'
  ).all(itemId);

  const choicesStmt = db.prepare(
    'SELECT * FROM menu_item_option_choices WHERE group_id = ? ORDER BY sort_order, id'
  );

  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    is_required: g.is_required,
    is_single_choice: g.is_single_choice,
    sort_order: g.sort_order,
    choices: choicesStmt.all(g.id).map((c) => ({
      id: c.id,
      name: c.name,
      is_default: c.is_default,
      sort_order: c.sort_order,
    })),
  }));
}

function validateGroups(groups) {
  if (!Array.isArray(groups)) {
    return { ok: false, error: 'groups must be an array' };
  }
  for (let gi = 0; gi < groups.length; gi++) {
    const g = groups[gi];
    if (!g || typeof g !== 'object') return { ok: false, error: `group ${gi} must be an object` };
    if (typeof g.name !== 'string' || g.name.trim() === '') {
      return { ok: false, error: `group ${gi}: name is required` };
    }
    if (!Array.isArray(g.choices) || g.choices.length === 0) {
      return { ok: false, error: `group "${g.name}": at least one choice is required` };
    }
    for (let ci = 0; ci < g.choices.length; ci++) {
      const c = g.choices[ci];
      if (!c || typeof c !== 'object') {
        return { ok: false, error: `group "${g.name}" choice ${ci}: must be an object` };
      }
      if (typeof c.name !== 'string' || c.name.trim() === '') {
        return { ok: false, error: `group "${g.name}" choice ${ci}: name is required` };
      }
    }
    const defaults = g.choices.filter((c) => c.is_default).length;
    const isRequiredSingle = g.is_required && g.is_single_choice;
    if (isRequiredSingle && defaults !== 1) {
      return {
        ok: false,
        error: `group "${g.name}": required single-choice groups need exactly one default choice`,
      };
    }
    if (defaults > 1 && g.is_single_choice) {
      return { ok: false, error: `group "${g.name}": single-choice group can have at most one default` };
    }
  }
  return { ok: true };
}

export function adminMenuOptionsRouter({ db }) {
  const router = Router({ mergeParams: true });

  // GET /api/admin/menu-items/:itemId/options
  router.get('/', (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ error: 'invalid itemId' });
    }
    const item = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(itemId);
    if (!item) return res.status(404).json({ error: 'menu item not found' });

    res.json({ groups: loadOptionsTree(db, itemId) });
  });

  // PUT /api/admin/menu-items/:itemId/options
  // Replaces the entire options tree. Sends back the new state with fresh ids.
  router.put('/', (req, res) => {
    const itemId = Number(req.params.itemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      return res.status(400).json({ error: 'invalid itemId' });
    }
    const item = db.prepare('SELECT id FROM menu_items WHERE id = ?').get(itemId);
    if (!item) return res.status(404).json({ error: 'menu item not found' });

    const { groups } = req.body ?? {};
    const checked = validateGroups(groups);
    if (!checked.ok) return res.status(400).json({ error: checked.error });

    try {
      const replace = db.transaction(() => {
        // Delete existing groups (cascades to choices)
        db.prepare('DELETE FROM menu_item_option_groups WHERE menu_item_id = ?').run(itemId);

        const insertGroup = db.prepare(
          `INSERT INTO menu_item_option_groups
             (menu_item_id, name, is_required, is_single_choice, sort_order)
           VALUES (?, ?, ?, ?, ?)`
        );
        const insertChoice = db.prepare(
          `INSERT INTO menu_item_option_choices
             (group_id, name, is_default, sort_order)
           VALUES (?, ?, ?, ?)`
        );

        for (let gi = 0; gi < groups.length; gi++) {
          const g = groups[gi];
          const gResult = insertGroup.run(
            itemId,
            g.name.trim(),
            g.is_required ? 1 : 0,
            g.is_single_choice ? 1 : 0,
            Number.isInteger(g.sort_order) ? g.sort_order : gi
          );
          const groupId = gResult.lastInsertRowid;

          for (let ci = 0; ci < g.choices.length; ci++) {
            const c = g.choices[ci];
            insertChoice.run(
              groupId,
              c.name.trim(),
              c.is_default ? 1 : 0,
              Number.isInteger(c.sort_order) ? c.sort_order : ci
            );
          }
        }
      });

      replace();
    } catch (err) {
      console.error('[admin.menu-options] PUT error:', err);
      return res.status(500).json({ error: 'internal error' });
    }

    res.json({ groups: loadOptionsTree(db, itemId) });
  });

  return router;
}
