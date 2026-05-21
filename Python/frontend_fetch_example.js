// frontend_fetch_example.js
//
// This shows how React/JavaScript could call your Python FastAPI server.
//
// Assumption:
// Python server is running at http://localhost:8000

async function loadMatches(questionId) {
  const response = await fetch(`http://localhost:8000/matches/${questionId}?limit=5`);
  const data = await response.json();

  if (!data.success) {
    console.error(data.message);
    return;
  }

  console.log("Matches:", data.matches);

  data.matches.forEach((match, index) => {
    console.log(`${index + 1}. ${match.mentor_name}`);
    console.log(`Score: ${match.score}`);
    console.log(`Level: ${match.match_level}`);
    console.log("Reasons:", match.reasons);
  });
}

loadMatches(1);
