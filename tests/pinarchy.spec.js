const { test, expect } = require('@playwright/test')

const BASE = 'http://localhost:3000'

const VIEWPORTS = [
   { name: 'mobile',  width: 390,  height: 844  },
   { name: 'tablet',  width: 768,  height: 1024 },
   { name: 'desktop', width: 1280, height: 800  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

async function clearRegistrations() {
   const { execSync } = require('child_process')
   execSync('node tests/reset-db.js', { cwd: '/Users/garnett/claude/pinarchy' })
}

// ── Tests ─────────────────────────────────────────────────────────────────────

test.describe('Heading and layout', () => {
   for (const vp of VIEWPORTS) {
      test(`shows heading on ${vp.name}`, async ({ page }) => {
         await page.setViewportSize({ width: vp.width, height: vp.height })
         await page.goto(BASE)
         await expect(page.locator('main h1')).toContainText('Pinarchy in Parkwood')
      })

      test(`shows table with 22 timeslot rows on ${vp.name}`, async ({ page }) => {
         await page.setViewportSize({ width: vp.width, height: vp.height })
         await page.goto(BASE)
         const rows = page.locator('#registrations-body tr')
         await expect(rows).toHaveCount(22)
      })

      test(`shows print button on ${vp.name}`, async ({ page }) => {
         await page.setViewportSize({ width: vp.width, height: vp.height })
         await page.goto(BASE)
         await expect(page.locator('#print-btn')).toBeVisible()
      })
   }
})

test.describe('Timeslots', () => {
   test('first slot is 11:30am and last is 3:00pm', async ({ page }) => {
      await page.goto(BASE)
      const rows = page.locator('#registrations-body tr')
      const firstTime = await rows.first().locator('.time-cell').textContent()
      const lastTime  = await rows.last().locator('.time-cell').textContent()
      expect(firstTime.trim()).toBe('11:30am')
      expect(lastTime.trim()).toBe('3:00pm')
   })

   test('each row has two player inputs', async ({ page }) => {
      await page.goto(BASE)
      const firstRow = page.locator('#registrations-body tr').first()
      const inputs = firstRow.locator('input.player-input')
      await expect(inputs).toHaveCount(2)
   })
})

test.describe('Registration (ownership)', () => {
   test.beforeEach(async () => { await clearRegistrations() })

   test('can type a name into an empty slot', async ({ page }) => {
      await page.goto(BASE)
      const input = page.locator('#registrations-body tr').first().locator('input').first()
      await input.fill('Alice')
      await input.blur()
      // Wait for SSE round-trip to confirm the value persisted
      await expect(input).toHaveValue('Alice', { timeout: 5000 })
   })

   test('owned field is not editable by a different visitor', async ({ browser }) => {
      // Context 1: Alice registers
      const ctx1 = await browser.newContext()
      const page1 = await ctx1.newPage()
      await page1.goto(BASE)
      const input1 = page1.locator('#registrations-body tr').first().locator('input').first()
      await input1.fill('Alice')
      await input1.blur()
      // Wait until Alice's own field reflects the saved value
      await expect(input1).toHaveValue('Alice', { timeout: 5000 })
      await expect(input1).not.toHaveAttribute('readonly', { timeout: 5000 })

      // Context 2: Bob visits (different cookie)
      const ctx2 = await browser.newContext()
      const page2 = await ctx2.newPage()
      await page2.goto(BASE)
      const input2 = page2.locator('#registrations-body tr').first().locator('input').first()
      await expect(input2).toHaveValue('Alice', { timeout: 5000 })
      await expect(input2).toHaveAttribute('readonly', '')

      await ctx1.close()
      await ctx2.close()
   })

   test('clearing a name releases ownership', async ({ browser }) => {
      // Context 1: Alice registers then clears
      const ctx1 = await browser.newContext()
      const page1 = await ctx1.newPage()
      await page1.goto(BASE)
      const input1 = page1.locator('#registrations-body tr').first().locator('input').first()
      await input1.fill('Alice')
      await input1.blur()
      // Wait until Alice's field is confirmed saved (editable by Alice, shows 'Alice')
      await expect(input1).toHaveValue('Alice', { timeout: 5000 })
      await expect(input1).not.toHaveAttribute('readonly', { timeout: 5000 })
      // Now Alice clears her name
      await input1.fill('')
      await input1.blur()
      // Wait until Alice's field is empty and unowned (editable by anyone)
      await expect(input1).toHaveValue('', { timeout: 5000 })

      // Context 2: Bob can now edit
      const ctx2 = await browser.newContext()
      const page2 = await ctx2.newPage()
      await page2.goto(BASE)
      const input2 = page2.locator('#registrations-body tr').first().locator('input').first()
      await expect(input2).not.toHaveAttribute('readonly')
      await input2.fill('Bob')
      await input2.blur()
      await expect(input2).toHaveValue('Bob', { timeout: 5000 })

      await ctx1.close()
      await ctx2.close()
   })
})

test.describe('Real-time updates', () => {
   test.beforeEach(async () => { await clearRegistrations() })

   test('name entered in one browser appears in another without refresh', async ({ browser }) => {
      const ctx1 = await browser.newContext()
      const ctx2 = await browser.newContext()
      const page1 = await ctx1.newPage()
      const page2 = await ctx2.newPage()

      await page1.goto(BASE)
      await page2.goto(BASE)

      // Page2 is watching; Page1 types a name
      const input1 = page1.locator('#registrations-body tr').nth(2).locator('input').first()
      await input1.fill('Charlie')
      await input1.blur()

      // Page2 should update automatically via SSE
      const input2 = page2.locator('#registrations-body tr').nth(2).locator('input').first()
      await expect(input2).toHaveValue('Charlie', { timeout: 5000 })

      await ctx1.close()
      await ctx2.close()
   })
})

test.describe('Admin', () => {
   test('/admin returns 404 when ADMIN_PASSWORD not set', async ({ page }) => {
      const res = await page.request.get(`${BASE}/admin`)
      expect(res.status()).toBe(404)
   })
})
