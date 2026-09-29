-- Deterministic hash of the synthetic records that pending appointment migrations may touch.
-- Run only against the disposable local rehearsal database.

select encode(
  digest(
    jsonb_build_object(
      'households', coalesce((
        select jsonb_agg(to_jsonb(row_value) order by row_value.id)
        from public.households row_value
      ), '[]'::jsonb),
      'household_members', coalesce((
        select jsonb_agg(to_jsonb(row_value) order by row_value.id)
        from public.household_members row_value
      ), '[]'::jsonb),
      'member_sessions', coalesce((
        select jsonb_agg(to_jsonb(row_value) order by row_value.token)
        from public.member_sessions row_value
      ), '[]'::jsonb),
      'calendar_connections', coalesce((
        select jsonb_agg(to_jsonb(row_value) order by row_value.id)
        from public.calendar_connections row_value
      ), '[]'::jsonb),
      'captures', coalesce((
        select jsonb_agg(to_jsonb(row_value) order by row_value.id)
        from public.captures row_value
      ), '[]'::jsonb),
      'events', coalesce((
        select jsonb_agg(to_jsonb(row_value) order by row_value.id)
        from public.events row_value
      ), '[]'::jsonb),
      'tasks', coalesce((
        select jsonb_agg(to_jsonb(row_value) order by row_value.id)
        from public.tasks row_value
      ), '[]'::jsonb),
      'audit_log', coalesce((
        select jsonb_agg(to_jsonb(row_value) order by row_value.id)
        from public.audit_log row_value
      ), '[]'::jsonb),
      'bridge_deliveries', coalesce((
        select jsonb_agg(to_jsonb(row_value) order by row_value.event_id)
        from private.appointment_bridge_deliveries row_value
      ), '[]'::jsonb),
      'priority_review_queue', coalesce((
        select jsonb_agg(to_jsonb(row_value) order by row_value.task_id)
        from private.task_priority_review_queue row_value
      ), '[]'::jsonb)
    )::text,
    'sha256'
  ),
  'hex'
) as synthetic_data_sha256;
