import { test, expect, Page } from '@playwright/test';

test.describe('Coach-Min Assessment Lifecycle E2E', () => {
  let page: Page;

  test.beforeEach(async ({ page: p }) => {
    page = p;

    // Mock the authentication to be logged in
    await page.context().addCookies([
      {
        name: 'auth-token',
        value: 'test-auth-token',
        domain: 'localhost',
        path: '/'
      }
    ]);

    // Mock the Convex client to return test data
    await page.route('**/api/convex/**', async (route) => {
      const request = route.request();
      const url = request.url();

      if (url.includes('/api/convex/query/skill_assessment_v3')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([])
        });
      } else if (url.includes('/api/convex/query/assessments_v3')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([])
        });
      } else if (url.includes('/api/convex/query/events')) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([])
        });
      } else {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({})
        });
      }
    });

    // Mock the assessment API endpoints
    await page.route('**/api/assessments/run', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          success: true,
          assessmentId: 'test-assessment-123'
        })
      });
    });

    await page.route('**/api/assessments/results', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          assessmentId: 'test-assessment-123',
          sessionId: 'test-session-123',
          groupId: 'test-group-123',
          results: {
            highlights: ['Good clarity in communication'],
            recommendations: ['Try more complex sentence structures'],
            rubricKeyPoints: ['Use because clauses', 'Practice relative clauses'],
            meta: {
              skillsCount: 1,
              provider: 'google',
              modelId: 'gemini-1.5-pro'
            },
            kpis: {
              averageLevel: 4,
              totalScore: 0.4
            },
            assessmentMetadata: {
              tokenCount: 1500,
              costCents: 5,
              processingTimeMs: 1200
            }
          },
          skillAssessments: [
            {
              assessmentId: 'test-assessment-123',
              skillId: 'clarity_eloquence',
              skillHash: 'test-hash-123',
              level: 4,
              confidence: 0.85,
              structuredFeedback: {
                primaryTakeaway: 'Your clarity is improving',
                primaryFocus: {
                  description: 'Focus on using more complex sentence structures',
                  nextLevelCriteria: 'Practice using because and relative clauses',
                  exampleToPractice: 'I enjoy reading because it relaxes me'
                },
                annotatedExamples: [
                  {
                    userQuote: 'I go to school',
                    annotation: 'Simple clause structure',
                    classification: 'improvement_opportunity',
                    relevantLevel: 3
                  },
                  {
                    userQuote: 'I stayed home because it rained',
                    annotation: 'Good use of because clause',
                    classification: 'strength',
                    relevantLevel: 4
                  }
                ]
              },
              quantitativeMetrics: {
                averageTUnitLength: 8.5,
                subordinationIndex: 0.25,
                conjunctionVariety: ['and', 'because', 'so']
              },
              assessmentMetadata: {
                provider: 'google',
                modelId: 'gemini-1.5-pro',
                tokenCount: 1500,
                costCents: 5,
                processingTimeMs: 1200
              },
              createdAt: Date.now(),
              updatedAt: Date.now()
            }
          ]
        })
      });
    });

    await page.goto('/coach-min');
  });

  test('should display assessment chip with correct initial state', async () => {
    // Check that the assessment chip is visible
    const assessmentChip = page.locator('[data-testid="assessment-chip"]');
    await expect(assessmentChip).toBeVisible();

    // Check initial state - should be dull/inactive since no assessment has been run
    await expect(assessmentChip).toHaveClass(/assessment-chip.*idle/);
  });

  test('should trigger assessment and show loading state', async () => {
    // Click the assessment chip to trigger assessment
    const assessmentChip = page.locator('[data-testid="assessment-chip"]');
    await assessmentChip.click();

    // Should show loading state
    await expect(assessmentChip).toHaveClass(/assessment-chip.*loading/);

    // Should show animation (light going around the edges)
    const loadingAnimation = assessmentChip.locator('.loading-animation');
    await expect(loadingAnimation).toBeVisible();
  });

  test('should complete assessment and show success state', async () => {
    // Trigger assessment
    const assessmentChip = page.locator('[data-testid="assessment-chip"]');
    await assessmentChip.click();

    // Wait for assessment to complete
    await page.waitForTimeout(2000); // Simulate assessment completion

    // Should show completed state
    await expect(assessmentChip).toHaveClass(/assessment-chip.*completed/);

    // Should be lit up (not dull)
    await expect(assessmentChip).not.toHaveClass(/assessment-chip.*idle/);
  });

  test('should expand and show assessment details', async () => {
    // Trigger assessment first
    const assessmentChip = page.locator('[data-testid="assessment-chip"]');
    await assessmentChip.click();
    await page.waitForTimeout(2000);

    // Click to expand details
    await assessmentChip.click();

    // Should show expanded view
    const expandedView = page.locator('[data-testid="assessment-details"]');
    await expect(expandedView).toBeVisible();

    // Should show structured feedback
    const primaryTakeaway = expandedView.locator('[data-testid="primary-takeaway"]');
    await expect(primaryTakeaway).toContainText('Your clarity is improving');

    // Should show primary focus
    const primaryFocus = expandedView.locator('[data-testid="primary-focus"]');
    await expect(primaryFocus).toContainText('Focus on using more complex sentence structures');

    // Should show next level criteria
    const nextLevelCriteria = expandedView.locator('[data-testid="next-level-criteria"]');
    await expect(nextLevelCriteria).toContainText('Practice using because and relative clauses');

    // Should show annotated examples
    const annotatedExamples = expandedView.locator('[data-testid="annotated-examples"]');
    await expect(annotatedExamples).toContainText('Simple clause structure');
    await expect(annotatedExamples).toContainText('Good use of because clause');

    // Should show quantitative metrics
    const quantitativeMetrics = expandedView.locator('[data-testid="quantitative-metrics"]');
    await expect(quantitativeMetrics).toContainText('Average T-Unit Length: 8.5');
    await expect(quantitativeMetrics).toContainText('Subordination Index: 0.25');
  });

  test('should show assessment in debug panel', async () => {
    // Open debug panel
    const debugToggle = page.locator('[data-testid="debug-toggle"]');
    await debugToggle.click();

    // Switch to ASSESS tab
    const assessTab = page.locator('[data-testid="debug-tab-assess"]');
    await assessTab.click();

    // Should show assessment summary
    const assessmentSummary = page.locator('[data-testid="assessment-summary"]');
    await expect(assessmentSummary).toContainText('Average Level: 4');
    await expect(assessmentSummary).toContainText('Skills Count: 1');

    // Should show skill assessment details
    const skillAssessment = page.locator('[data-testid="skill-assessment-details"]');
    await expect(skillAssessment).toContainText('Clarity & Eloquence');
    await expect(skillAssessment).toContainText('Level: 4');
    await expect(skillAssessment).toContainText('Confidence: 0.85');
  });

  test('should handle assessment errors gracefully', async () => {
    // Mock assessment API to return error
    await page.route('**/api/assessments/run', async (route) => {
      await route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'Assessment failed due to API error'
        })
      });
    });

    // Trigger assessment
    const assessmentChip = page.locator('[data-testid="assessment-chip"]');
    await assessmentChip.click();

    // Wait for error state
    await page.waitForTimeout(2000);

    // Should show error state
    await expect(assessmentChip).toHaveClass(/assessment-chip.*error/);

    // Should show error message
    const errorMessage = page.locator('[data-testid="assessment-error"]');
    await expect(errorMessage).toBeVisible();
    await expect(errorMessage).toContainText('Assessment failed');
  });

  test('should handle multiple assessment sessions', async () => {
    // First assessment
    const assessmentChip = page.locator('[data-testid="assessment-chip"]');
    await assessmentChip.click();
    await page.waitForTimeout(2000);

    // Should be completed
    await expect(assessmentChip).toHaveClass(/assessment-chip.*completed/);

    // Click again to expand
    await assessmentChip.click();

    // Should show first assessment details
    const primaryTakeaway1 = page.locator('[data-testid="primary-takeaway"]');
    await expect(primaryTakeaway1).toContainText('Your clarity is improving');

    // Close expanded view
    const closeButton = page.locator('[data-testid="close-assessment-details"]');
    await closeButton.click();

    // Mock different results for second assessment
    await page.route('**/api/assessments/results', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          assessmentId: 'test-assessment-456',
          sessionId: 'test-session-456',
          groupId: 'test-group-456',
          results: {
            highlights: ['Improved sentence variety'],
            recommendations: ['Continue practicing complex structures'],
            rubricKeyPoints: ['Use more relative clauses'],
            meta: {
              skillsCount: 1,
              provider: 'google',
              modelId: 'gemini-1.5-pro'
            },
            kpis: {
              averageLevel: 5,
              totalScore: 0.5
            }
          },
          skillAssessments: [
            {
              assessmentId: 'test-assessment-456',
              skillId: 'clarity_eloquence',
              skillHash: 'test-hash-456',
              level: 5,
              confidence: 0.9,
              structuredFeedback: {
                primaryTakeaway: 'Great improvement in sentence variety',
                primaryFocus: {
                  description: 'Continue practicing complex sentence structures',
                  nextLevelCriteria: 'Use more relative clauses consistently',
                  exampleToPractice: 'The book that I read was interesting'
                },
                annotatedExamples: [
                  {
                    userQuote: 'The book that I read was interesting',
                    annotation: 'Excellent use of relative clause',
                    classification: 'strength',
                    relevantLevel: 5
                  }
                ]
              },
              createdAt: Date.now(),
              updatedAt: Date.now()
            }
          ]
        })
      });
    });

    // Trigger second assessment
    await assessmentChip.click();
    await page.waitForTimeout(2000);
    await assessmentChip.click();

    // Should show second assessment details
    const primaryTakeaway2 = page.locator('[data-testid="primary-takeaway"]');
    await expect(primaryTakeaway2).toContainText('Great improvement in sentence variety');
  });

  test('should update debug panel with new assessment data', async () => {
    // Open debug panel
    const debugToggle = page.locator('[data-testid="debug-toggle"]');
    await debugToggle.click();

    const assessTab = page.locator('[data-testid="debug-tab-assess"]');
    await assessTab.click();

    // Trigger assessment
    const assessmentChip = page.locator('[data-testid="assessment-chip"]');
    await assessmentChip.click();
    await page.waitForTimeout(2000);

    // Debug panel should update automatically
    const assessmentSummary = page.locator('[data-testid="assessment-summary"]');
    await expect(assessmentSummary).toContainText('Average Level: 4');
    await expect(assessmentSummary).toContainText('Skills Count: 1');

    // Should show recent assessment history
    const recentAssessments = page.locator('[data-testid="recent-assessments"]');
    await expect(recentAssessments).toContainText('test-assessment-123');
  });
});
