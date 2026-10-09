(() => {
  "use strict";

  const $ = id => document.getElementById(id);
  const message = text => {
    $("accountFeedback").textContent = text;
  };

  const config = window.SALAS64_CONFIG;

  if (!config || !window.supabase) {
    message("Account connection could not load. Refresh the page.");
    return;
  }

  let client;

  try {
    client = window.supabase.createClient(
      config.supabaseUrl,
      config.supabasePublishableKey
    );
  } catch {
    message("Account connection settings are invalid.");
    return;
  }

  window.salas64Client = client;

  let user = null;
  let profile = null;
  let teams = [];
  let busy = false;
  let starting = true;
  let version = 0;

  function controls() {
    $("accountForm").hidden = Boolean(user);
    $("profilePanel").hidden = !user;

    $("accountStatus").textContent = starting
      ? "Connecting…"
      : user
        ? "Signed in"
        : "Signed out";

    $("signedInEmail").textContent = user?.email || "";

    $("signInBtn").disabled = busy || starting;
    $("signUpBtn").disabled = busy || starting;
    $("saveProfileBtn").disabled = busy || !profile;
    $("displayName").disabled = busy || !profile;
    $("signOutBtn").disabled = busy;
  }

  function teamId(team) {
    return String(
      team.teamId ||
      team.espnId ||
      team.logo?.match(/\/([0-9]+)\.(?:png|svg)/)?.[1] ||
      `name:${team.team}`
    );
  }

  function renderTeams() {
    const list = $("favoriteTeamsList");
    list.replaceChildren();

    if (!user || !profile) return;

    const selected = new Set(profile.favorite_team_ids || []);
    const query = $("favoriteSearch").value.trim().toLowerCase();

    const visible = teams
      .filter(team => team.team.toLowerCase().includes(query))
      .sort((a, b) =>
        Number(selected.has(teamId(b))) -
        Number(selected.has(teamId(a))) ||
        a.rank - b.rank
      );

    if (!teams.length) {
      const note = document.createElement("p");
      note.className = "meta";
      note.textContent =
        "Team list is unavailable. Refresh to try again.";
      list.append(note);
    } else if (!visible.length) {
      const note = document.createElement("p");
      note.textContent = "No matching teams.";
      list.append(note);
    }

    for (const team of visible) {
      const id = teamId(team);
      const followed = selected.has(id);

      const button = document.createElement("button");
      button.type = "button";
      button.className = "pick-team";
      button.disabled = busy;
      button.setAttribute("aria-pressed", String(followed));

      button.textContent =
        `${followed ? "★" : "☆"} #${team.rank} ` +
        `${team.team} · ${team.record || "—"}`;

      button.onclick = () => toggleTeam(id, team.team);
      list.append(button);
    }

    if (!query) {
      const known = new Set(teams.map(teamId));

      for (const id of selected) {
        if (known.has(id)) continue;

        const button = document.createElement("button");
        button.type = "button";
        button.className = "pick-team";
        button.disabled = busy;

        button.textContent =
          `★ Saved team ${id} · outside current Salas 64 · Unfollow`;

        button.onclick = () => toggleTeam(id, "Saved team");
        list.append(button);
      }
    }
  }

  async function syncSession(session) {
    const next = session?.user || null;

    if (!starting && next?.id === user?.id && profile) return;

    const ticket = ++version;

    user = next;
    profile = null;
    starting = false;

    $("displayName").value = "";
    $("favoriteTeamsList").replaceChildren();

    controls();

    window.dispatchEvent(new CustomEvent("salas64:auth", {
      detail: { userId: user?.id || null }
    }));

    if (!user) return;

    const id = user.id;
    message("Loading your profile…");

    try {
      let result = await client
        .from("profiles")
        .select("*")
        .eq("id", id)
        .maybeSingle();

      if (result.error) throw result.error;

      if (!result.data) {
        const created = await client
          .from("profiles")
          .upsert(
            { id },
            { onConflict: "id", ignoreDuplicates: true }
          );

        if (created.error) throw created.error;

        result = await client
          .from("profiles")
          .select("*")
          .eq("id", id)
          .single();

        if (result.error) throw result.error;
      }

      if (ticket !== version) return;

      profile = result.data;
      $("displayName").value = profile.display_name || "";

      message(
        "Your profile and favorite teams are saved to your account."
      );

      controls();
      renderTeams();
    } catch (error) {
      if (ticket !== version) return;

      message(`Profile could not load: ${error.message}`);
      controls();
    }
  }

  async function save(fields, success) {
    if (!user || !profile || busy) return;

    const id = user.id;
    const ticket = version;

    busy = true;
    controls();
    renderTeams();
    message("Saving…");

    try {
      const { data, error } = await client
        .from("profiles")
        .update(fields)
        .eq("id", id)
        .select("*")
        .single();

      if (error) throw error;
      if (ticket !== version) return;

      profile = data;
      message(success);
    } catch (error) {
      if (ticket === version) {
        message(`Could not save: ${error.message}`);
      }
    } finally {
      busy = false;
      controls();
      renderTeams();
    }
  }

  function toggleTeam(id, name) {
    const selected = new Set(profile?.favorite_team_ids || []);
    const removing = selected.has(id);

    if (removing) selected.delete(id);
    else selected.add(id);

    return save(
      { favorite_team_ids: [...selected] },
      removing ? `Unfollowed ${name}.` : `Following ${name}.`
    );
  }

  $("favoriteSearch").oninput = renderTeams;

  $("saveProfileBtn").onclick = () => save(
    {
      display_name: $("displayName").value.trim().slice(0, 40)
    },
    "Display name saved."
  );

  $("accountForm").onsubmit = async event => {
    event.preventDefault();

    if (busy || starting) return;

    busy = true;
    controls();
    message("Connecting…");

    const credentials = {
      email: $("authEmail").value.trim(),
      password: $("authPassword").value
    };

    try {
      const signup = event.submitter?.id === "signUpBtn";

      const { data, error } = signup
        ? await client.auth.signUp({
            ...credentials,
            options: {
              emailRedirectTo: "https://salas64rankings.com/"
            }
          })
        : await client.auth.signInWithPassword(credentials);

      if (error) throw error;

      $("authPassword").value = "";

      if (data.session) {
        await syncSession(data.session);
      } else {
        message(
          "Check your email for a confirmation link, then sign in."
        );
      }
    } catch (error) {
      message(error.message || "Sign-in failed. Please try again.");
    } finally {
      busy = false;
      controls();
      renderTeams();
    }
  };

  $("signOutBtn").onclick = async () => {
    if (busy) return;

    busy = true;
    controls();

    try {
      const { error } = await client.auth.signOut({
        scope: "local"
      });

      if (error) throw error;

      await syncSession(null);
      message("Signed out.");
      $("authPassword").value = "";
    } catch (error) {
      message(error.message);
    } finally {
      busy = false;
      controls();
      renderTeams();
    }
  };

  client.auth.onAuthStateChange((_event, session) => {
    setTimeout(() => syncSession(session), 0);
  });

  controls();

  client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return syncSession(data.session);
    })
    .catch(error => {
      starting = false;
      controls();
      message(error.message);
    });

  fetch(`data/current.json?v=${Date.now()}`, {
    cache: "no-store"
  })
    .then(response => {
      if (!response.ok) throw Error("Team data unavailable");
      return response.json();
    })
    .then(data => {
      teams = (data.rankings || []).filter(
        team => typeof team.team === "string"
      );
      renderTeams();
    })
    .catch(() => {
      teams = [];
      renderTeams();
    });
})();
