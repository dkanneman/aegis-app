-- Compensating rollback preserves proposal decisions and immutable audit evidence.
-- Restore author-only canonical writes; do not drop evidence-bearing columns.
do $rollback$
declare definition text; start_at integer; end_at integer;
begin
 definition:=pg_get_functiondef('private.apply_capture_plan(uuid,uuid,text,jsonb)'::regprocedure);
 start_at:=position('if not found or (capture_row.member_id is distinct from actor_member_id_input and not (' in definition);
 end_at:=position(')) then' in substring(definition from start_at));
 if start_at=0 or end_at=0 then raise exception 'Unrecognized proposal guard'; end if;
 definition:=overlay(definition placing 'if not found or capture_row.member_id is distinct from actor_member_id_input then'
   from start_at for end_at+6);
 execute definition;
end;
$rollback$;
